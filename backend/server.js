// load required modules
var express = require('express');
var cors = require('cors');
const turf = require('@turf/turf');
const fetch = require('node-fetch');
var bodyParser = require('body-parser');
var app = express();
const { IamAuthenticator } = require('ibm-cloud-sdk-core');
const { CloudantV1 } = require('@ibm-cloud/cloudant');
const { json } = require('body-parser');
// const fetch = require('node-fetch');
const swaggerjsdoc = require('swagger-jsdoc')
const swaggerui = require('swagger-ui-express')
const YAML = require('yamljs');
const swaggerDocument = YAML.load('./swagger.yaml');
const ibmdb = require('ibm_db');

require('dotenv').config();

const dbConfig = {
    port: '30371',
    protocol: 'TCPIP',
};

const connString = `DATABASE=${process.env.DB2_DATABASE};HOSTNAME=${process.env.DB2_HOSTNAME};UID=${process.env.DB2_USER};PWD=${process.env.DB2_PWD};PORT=${dbConfig.port};PROTOCOL=${dbConfig.protocol};Security=SSL;`;
const wkt = require('wkt');
    
const tf = require("@tensorflow/tfjs");
const tfn = require("@tensorflow/tfjs-node");

const India_model = tf.loadLayersModel(tfn.io.fileSystem("models/India/model.json"));
const Kenya_model = tf.loadLayersModel(tfn.io.fileSystem("models/Kenya/model.json"));
// load local .env if present
require("dotenv").config();
const IBM = require('ibm-cos-sdk');
const { polygon, hexGrid } = require("@turf/turf");

app.use(
    "/api-docs",
    swaggerui.serve,
    swaggerui.setup(swaggerDocument)
)

// enable parsing of http request body
app.use(bodyParser.urlencoded({ limit: '50mb', extended: false }));
app.use(bodyParser.json({ limit: '50mb' }));

app.use(cors());
// set the database name

const placesName = 'places_db'
DB_NAME_BUILDINGS = "buildings_db"
DESIGN_DOCUMENT = 'Lat_Lon_sIdx'
INDEX_NAME = 'lat_lon_Q_index'
GEOJSON_BUCKET_NAME = 'geojson-features-merged'
BUILDINGS_THRESHOLD = 20

let cloudant_apikey, cloudant_url;

let cors_config = {
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    preflightContinue: true,
    optionsSuccessStatus: 204
}

let cors_config_survey = {
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    headers: "Content-Type, Authorization, Cache-Control, Content-Language, Content-Length, Content-Type, Expires, Last-Modified",
    preflightContinue: true,
    optionsSuccessStatus: 204
}

// extract the Cloudant API key and URL from the credentials
if (process.env.CE_SERVICES) {
    ce_services = JSON.parse(process.env.CE_SERVICES);
    cloudant_apikey = ce_services['cloudantnosqldb'][0].credentials.apikey;
    cloudant_url = ce_services['cloudantnosqldb'][0].credentials.url;
}
// allow overwriting of Cloudant setup or to specify using environment variables
if (process.env.CLOUDANT_URL) {
    cloudant_url = process.env.CLOUDANT_URL;
}
if (process.env.CLOUDANT_APIKEY) {
    cloudant_apikey = process.env.CLOUDANT_APIKEY;
}

// to overwrite the origin for testing
if (process.env.CORS_ORIGIN) {
    cors_config.origin = process.env.CORS_ORIGIN;
}

// establish IAM-based authentication
const authenticator = new IamAuthenticator({
    apikey: cloudant_apikey,
});

if (process.env.CLOUDANT_KEY) {
    cloudant_auth_apikey = process.env.CLOUDANT_KEY;
}

const authenticatorUI = new IamAuthenticator({
    apikey: cloudant_auth_apikey,
});

const prepareGeoJSON = (data) => {

    let geoJSON = {
        type: "FeatureCollection",
        features: []
    }

    data.forEach((doc, idx) => {

        // initiate GEOjson entry with all the necessary fields
        let coordinates_arr = wkt.parse(doc.POLYGON_COORDINATES).coordinates[0]

        let geoJSONEntry = {
            geometry: {
                coordinates: [coordinates_arr],
                type: 'Polygon'
            },
            id: idx,
            properties: {
                type_source: doc.CLASSIFICATION_SOURCE,
                res_type: doc.CLASSIFICATION_TYPE,
                height: doc.HEIGHT,
                area_in_meters: doc.AREA_IN_METERS,
                latitude: doc.LATITUDE,
                longitude: doc.LONGITUDE,
                source: doc.FOOTPRINT_SOURCE,
                urban_split: doc.URBAN_SPLIT,
                ghsl_smod: doc.GHSL_SMOD,
                floors: doc.FLOORS,
                gfa_in_meters: doc.GFA_IN_METERS,
                building_faces: doc.BUILDING_FACES,
                perimeter_in_meters: doc.PERIMETER_IN_METERS,
                osm_type: doc.OSM_TYPE,
                elec_access_percent: doc.ELEC_ACCESS_PERCENT,
                elec_consumption_kwh_month: doc.ELEC_CONSUMPTION_KWH_MONTH,
                elec_consumption_std_kwh_month: doc.ELEC_CONSUMPTION_STD_KWH_MONTH
            },
            type: "Feature"
        }

        if (doc.CLASSIFICATION_SOURCE === 'classification_model') {
            if (doc.CLASSIFICATION_TYPE === 'non-res')
                geoJSONEntry['properties']['confidence'] = parseFloat(100 * (1 - doc.ML_CONFIDENCE)).toFixed(2)
            else {
                geoJSONEntry['properties']['confidence'] = parseFloat(100 * doc.ML_CONFIDENCE).toFixed(2)
            }
        }

        if (doc.FOOTPRINT_SOURCE === 'osm') {
            geoJSONEntry['properties']['osm_id'] = doc.OSM_ID
        }


        // delete keys with undefined value from geoJSONEntry
        Object.keys(geoJSONEntry.properties).forEach(key => geoJSONEntry.properties[key] === undefined && delete geoJSONEntry.properties[key])

        // add entry to the main GEOjson instance
        geoJSON.features.push(geoJSONEntry)

    });
    return geoJSON;
}

async function fetchBuildingsFromBbox(coordinates, dbName) {
    var polygon = turf.polygon([coordinates]);
    let bbox = turf.bbox(polygon);
    
    const fields = ['ID', 'CLASSIFICATION_SOURCE','OSM_TYPE', 'CLASSIFICATION_TYPE', 'OSM_ID', 'HEIGHT',
        'ML_CONFIDENCE', 'AREA_IN_METERS', 'POLYGON_COORDINATES', 'LATITUDE', 'LONGITUDE', 'FOOTPRINT_SOURCE', 'CLASSIFICATION_TYPE',
        'URBAN_SPLIT', 'GHSL_SMOD', 'FLOORS', 'GFA_IN_METERS', 'BUILDING_FACES', 'PERIMETER_IN_METERS', 'ELEC_ACCESS_PERCENT', 'ELEC_CONSUMPTION_KWH_MONTH', 'ELEC_CONSUMPTION_STD_KWH_MONTH'];
    const sqlQuery = `SELECT ${fields.join(', ')} FROM USER1.${dbName} WHERE LONGITUDE BETWEEN ${bbox[0]} AND ${bbox[2]} AND LATITUDE BETWEEN ${bbox[1]} AND ${bbox[3]}`;
    console.log(sqlQuery);
    let conn = await ibmdb.open(connString);
    console.log("DB ACTIVE")
    let stmt = await conn.prepare(sqlQuery);
    let result = await stmt.execute();
    buildings_in_bbox = await result.fetchAll();
    return buildings_in_bbox;

}

app.post("/seforall/countOfBuildings", cors(cors_config), async function (req, res, next) {
    // Retrieve boundaries polygon coordinates and place name
    const startTime = performance.now();
    south = parseFloat(req.body.south);
    west = parseFloat(req.body.west);
    north = parseFloat(req.body.north);
    east = parseFloat(req.body.east);
    polygonCoordinates = req.body.polygon_coordinates;
    place = req.body.place
    place = place.charAt(0).toUpperCase() + place.slice(1);

    let country_name;
    switch (req.body.country_name) {
        case 'Kenya':
            country_name = 'FEATURES_DB_VIDA_EXTENDED';
            break;
        case 'Maharashtra':
            country_name = 'FEATURES_DB_MAHARASHTRA';
            break;
        case 'Tamil_Nadu':
            country_name = 'FEATURES_DB_TAMIL_NADU';
            break;
        case 'Nagaland':
            country_name = 'FEATURES_DB_NAGALAND';
            break;
        case 'Mizoram':
            country_name = 'FEATURES_DB_MIZORAM';
            break;
        case 'Madhya_Pradesh':
            country_name = 'FEATURES_DB_MADHYA_PRADESH';
            break;
        case 'Kerala':
            country_name = 'FEATURES_DB_KERALA';
            break;
        case 'Jharkhand':
            country_name = 'FEATURES_DB_JHARKHAND';
            break;
        case 'Assam':
            country_name = 'FEATURES_DB_ASSAM';
            break;
        default:
            country_name = 'FEATURES_DB_VIDA_EXTENDED';
            break;
    }

    // Define entry structure for places_db
    let entry = {
        createdAt: new Date().toISOString(),
        coordinates: "",
        place: place,
        geoJson_url: "",
        count_of_buildings: 0,
        rural: 0,
        urban: 0,
        suburban: 0,
        count_of_buildings_area: 0,
        count_of_buildings_osm: 0,
        count_of_buildings_classification_model: 0,
        count_of_buildings_res: 0,
        count_of_buildings_nonRes: 0,
        square_area: 0,
        square_area_res: 0,
        square_area_nonRes: 0,
        model_confidence_res: 0,
        model_confidence_nonRes: 0,
        height_avg: "",
        height_avg_res: "",
        height_avg_nonRes: ""
    }

    try {

        const coordinates = polygonCoordinates[0].map(point => [point.lng, point.lat]);
        coordinates.push(coordinates[0]);
        let fetchedBuildings = await fetchBuildingsFromBbox(coordinates, country_name)
        console.log('fetched buildings amount', fetchedBuildings.length)
        const endTime = performance.now();
        const elapsedTime = (endTime - startTime) / 1000;
        console.log("Elapsed time:", elapsedTime, "seconds");

        // Process presponse docs if ont none
        if (fetchedBuildings) {

            // Define polygon ant obtain centroid

            const polygon = turf.polygon([coordinates]);
            var polygon_centroid = turf.centroid(polygon);

            // Init counters
            var confidence_counter_res = 0;
            var confidence_counter_nonRes = 0;
            var height_counter_res = 0;
            var height_counter_nonRes = 0;
            var height_avg = 0;
            var cm_count_of_buildings_res = 0;
            var cm_count_of_buildings_nonres = 0;

            // Filter the documents to include only those inside the polygon
            const buildingsInsidePolygon = fetchedBuildings.filter((b) => {
                const point = turf.point([b.LONGITUDE, b.LATITUDE]);
                const isInside = turf.booleanPointInPolygon(point, polygon);
                return isInside === true;
            });

            console.log(buildingsInsidePolygon.length)

            // Now, loop through the filtered documents
            buildingsInsidePolygon.forEach((doc, idx) => {
                height_avg += doc.HEIGHT
                let confidence = 0
                if (doc.CLASSIFICATION_TYPE === "res") {
                    entry.count_of_buildings_res += 1;

                    if (doc.ML_CONFIDENCE !== 0) {
                        cm_count_of_buildings_res += 1
                        confidence = parseFloat(doc.ML_CONFIDENCE);
                        confidence_counter_res += confidence
                    }
                    entry.square_area_res += doc.AREA_IN_METERS;

                    height_counter_res += doc.HEIGHT;
                } else {
                    entry.count_of_buildings_nonRes += 1;

                    if (doc.ML_CONFIDENCE !== 0) {
                        cm_count_of_buildings_nonres += 1
                        confidence = 1 - parseFloat(doc.ML_CONFIDENCE);
                        confidence_counter_nonRes += confidence;
                    }
                    entry.square_area_nonRes += doc.AREA_IN_METERS;

                    height_counter_nonRes += doc.HEIGHT;
                }

                if (doc.FOOTPRINT_SOURCE === "osm") {
                    entry.count_of_buildings_osm += 1;
                } else if (doc.FOOTPRINT_SOURCE === "area") {
                    entry.count_of_buildings_area += 1;
                } else if (doc.FOOTPRINT_SOURCE === "classification_model") {
                    entry.count_of_buildings_classification_model += 1;
                }
                if (doc.URBAN_SPLIT === "Rural") {
                    entry.rural += 1;
                } else if (doc.URBAN_SPLIT === "Urban") {
                    entry.urban += 1;
                } else if (doc.URBAN_SPLIT === "Suburban") {
                    entry.suburban += 1;
                }


            });

            let geoJSON = prepareGeoJSON(buildingsInsidePolygon)

            // define geoJSONfilename for bucket storing
            let geoJSONfilename = `${place.split(' ').join('_')}_${polygon_centroid.geometry.coordinates[0]}_${polygon_centroid.geometry.coordinates[1]}.json`

            // Assign prepared data for places_db entry
            entry.coordinates = [coordinates]
            entry.geoJson_url = `https://geojson-features-merged.s3.eu-de.cloud-object-storage.appdomain.cloud/${geoJSONfilename}`
            entry.square_area = turf.area(polygon);
            entry.count_of_buildings = buildingsInsidePolygon.length;
            entry.model_confidence_res = confidence_counter_res / cm_count_of_buildings_res;
            entry.model_confidence_nonRes = confidence_counter_nonRes / cm_count_of_buildings_nonres;

            entry.height_avg_res = height_counter_res / entry.count_of_buildings_res;
            entry.height_avg_nonRes = height_counter_nonRes / entry.count_of_buildings_nonRes;
            entry.height_avg = height_avg / entry.count_of_buildings

            return res.status(201).json({
                count: entry.count_of_buildings,
                entry: entry,
                geoJSON: geoJSON,
                msg: "Time: " + elapsedTime.toFixed(2) + " seconds"
            });
        } else {
            console.log("Can not fetch the number of buildings. Aborting....");
            return res.status(500).json({
                message: "Can not fetch the number of buildings for the area. Aborting....",
            });
        }
    }
    catch {
        error => {
        return res.status(500).json({
            err: 'Error occured',
            message: error.body
        });
    }};
})


app.post("/seforall/processPolygon", cors(cors_config), async function (req, res, next) {
    let documentId = "16f5e1990c356ea6a9ca221e7c9fc593";
    let responseData = {};
    try {
        const docResponse = await cloudantClientUI.getDocument({
            db: 'api_track_db',
            docId: documentId
        });
        const doc = docResponse.result;
        doc.processPolygon++;

        const updateDocResponse = cloudantClientUI.putDocument({
            db: 'api_track_db',
            docId: doc._id,
            document: doc
        });
        responseData.updateDocResult = updateDocResponse.result;
    } catch (error) {
        res.status(500).json({error: 'Error'});
    }
    try {
        let country;
        switch (req.body.country) {
            case 'Kenya':
                country = 'FEATURES_DB_VIDA_EXTENDED';
                break;
            case 'Maharashtra':
                country = 'FEATURES_DB_MAHARASHTRA';
                break;
            case 'Tamil_Nadu':
                country = 'FEATURES_DB_TAMIL_NADU';
                break;
            case 'Nagaland':
                country = 'FEATURES_DB_NAGALAND';
                break;
            case 'Mizoram':
                country = 'FEATURES_DB_MIZORAM';
                break;
            case 'Madhya_Pradesh':
                country = 'FEATURES_DB_MADHYA_PRADESH';
                break;
            case 'Kerala':
                country = 'FEATURES_DB_KERALA';
                break;
            case 'Jharkhand':
                country = 'FEATURES_DB_JHARKHAND';
                break;
            case 'Assam':
                country = 'FEATURES_DB_ASSAM';
                break;    
            default:
                const error = new Error('Country not recognised');
                error.name = 'InvalidCountryError';
                throw error;
        }
        let polygonCoordinates = req.body.polygon[0]
        polygonCoordinates.push(polygonCoordinates[0])
        let buildings = await fetchBuildingsFromBbox(polygonCoordinates, country)

        let geoJSON = prepareGeoJSON(buildings)

        res.status(201).json({
            GeoJSON: geoJSON
        })

    } catch (error) {
        if (error.name === 'InvalidCountryError') {
            res.status(500).json({
                error: error.message
            });
        } else {
            console.log('process polygon error occured:', error);
            res.status(500).json({
                error: 'Internal server error'
            });
        }
    }

});

app.post("/seforall/processArea", cors(cors_config), async function (req, res, next) {
    let documentId = "fdb1faddd1f23163e58cc4b7126123b7";
    let responseData = {};
    try {
        const docResponse = await cloudantClientUI.getDocument({
            db: 'api_track_db',
            docId: documentId
        });
        const doc = docResponse.result;
        doc.processArea++;

        const updateDocResponse = cloudantClientUI.putDocument({
            db: 'api_track_db',
            docId: doc._id,
            document: doc
        });
        responseData.updateDocResult = updateDocResponse.result;
    } catch (error) {
        res.status(500).json({error: 'Error'});
    }
    try {
        let urlGeoJSON = "https://counties-geojsons.s3.eu-de.cloud-object-storage.appdomain.cloud/";
        let area = req.body.area;
        let geoJSON;

        if (area.startsWith("India_")) {
            area = area.replace("India_", "");
            urlGeoJSON += area + ".json";
        } else if (area.startsWith("Kenya_")) {
            urlGeoJSON += area + ".json";
        } else {
            return res.status(404).json({
                err: 'Area not exist',
                message: 'No documents found for the specified area'
            });
        }
        fetch(urlGeoJSON)
            .then(response => {
                return response.json();
            })
            .then(data => {
                geoJSON = data;
                res.status(200).json({
                    GeoJSON: geoJSON
                });
            })
            .catch(error => {
                res.status(500).json({
                    err: 'Error occurred',
                    message: error.message
                });
            });
    } catch (error) {
        res.status(500).json({
            err: 'Error occurred',
            message: error.message
        });
    }
});

app.post("/seforall/modelPredict", cors(cors_config), async function (req, res, next) {

    let documentId = "2e3653dce8ca6787d8e1b2dd9a1bc6bc";
    let responseData = {};
    try {
        const docResponse = await cloudantClientUI.getDocument({
            db: 'api_track_db',
            docId: documentId
        });
        const doc = docResponse.result;
        doc.modelPredict++;

        const updateDocResponse = cloudantClientUI.putDocument({
            db: 'api_track_db',
            docId: doc._id,
            document: doc
        });
        responseData.updateDocResult = updateDocResponse.result;

    } catch (error) {
        res.status(500).json({error: 'Error'});
    }



    try {

        let samples = req.body.samples;
        let model;

        if (req.body.country === 'Maharashtra') {
            model = India_model;
        } else if (req.body.country === 'Kenya') {
            model = Kenya_model;
        } else {
            model = null;
            res.status(500).json({
                err: 'Prediction error:',
                message: 'Model for specified country is not available'
            });

        }

        if (!Array.isArray(samples)) {
            throw new Error('Images must be provided as an array');
        }
        const predictions = []

        model.then(function (res) {
            for (let sample of samples) {
                let img = sample[0];
                let area = sample[1] / 20_000;
                let smod = sample[2] / 6;
                let t1 = tf.tensor([img])
                let t2 = tf.tensor([[area, smod]])
                const prediction = res.predict([t1, t2]).arraySync()[0][0];
                predictions.push(prediction);
            }
            return predictions
        }, function (err) {
            console.log('err', err);
            res.status(500).json({
                err: 'Model prediction error:',
                message: err
            });
        }).then((predictions) => {
            res.status(201).json({
                predictions: predictions
            })
        });
    } catch (error) {
        res.status(500).json({
            err: 'Server prediction error:',
            message: error.body
        });
    }

});

app.get("/seforall/getAllAreaNames", cors(cors_config), async (req, res) => {
    try {
        const url = 'https://counties-geojsons.s3.eu-de.cloud-object-storage.appdomain.cloud/geojson_subdistricts_map.json';

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Error fetching data');
        }
        const data = await response.json();

        res.status(201).json(data);
    } catch (error) {
        res.status(500).send('Error occured');
    }
});

// retrieve the existing place
app.post("/seforall/place", cors(cors_config), function (req, res, next) {
    place = req.body.place;
    const selector = {
        "place": place
    };

    cloudantClientUI.postFind({
        db: placesName,
        selector: selector,
        fields: [
            '_id'
        ],
    }).then(response => {
        if (response.result.docs.length > 0) {
            return res.json({ exists: true });
        } else {
            return res.json({ exists: false });
        }
    }).catch(error => {
        return res.status(500).json({
            err: 'Error occured',
            message: error.body
        });
    });
});

app.post("/seforall/survey", cors(cors_config_survey), async function (req, res, next) {
    try {
        let survey = req.body.beginSurvey;

        // Save entry to the survey_db
        let response = await cloudantClientUI.postDocument({
            db: "survey_db",
            document: survey,
        });

        console.log('Document saved: Response ' + response.result.id);

        // Send success response
        res.status(200).json({ message: 'Document saved successfully', id: response.result.id });
    } catch (error) {
        console.log('Error raised during saving document to DB: ' + error);

        // Send error response
        res.status(500).json({ message: 'Failed to save document', error: error.message });
    }
});


//feedback
app.post("/seforall/feedback", cors(cors_config), function (req, res, next) {
    let feedback = req.body.beginFeedback;
    // Save entry to the feedback_db
    let saveDoc = cloudantClientUI.postDocument({
        db: "feedback_db",
        document: feedback,
    }).then((response) => {
        console.log('Document saved: Response ' + response.result.id);
    })
    .catch((error) => {
        console.log('Error raised during saving document to DB: ' + error);
    })
});

//evaluation survey
app.post("/seforall/eval", cors(cors_config), function (req, res, next) {
    let eval = req.body.beginEval;
    // Save entry to the eval_db
    let saveDoc = cloudantClientUI.postDocument({
        db: "eval_db",
        document: eval,
    }).then((response) => {
        console.log('Document saved: Response ' + response.result.id);
    })
    .catch((error) => {
        console.log('Error raised during saving document to DB: ' + error);
    })
});

app.post("/seforall/shareDownloads", cors(cors_config), function (req, res, next) {
    let shareDownload = req.body.shareDownload;

    // Save entry to the feedback_db
    let saveDoc = cloudantClientUI.postDocument({
        db: "share_downloads_db",
        document: shareDownload,
    }).then((response) => {
        console.log('Document saved: Response ' + response.result.id);
    })
        .catch((error) => {
            console.log('Error raised during saving document to DB: ' + error);
        })
});

app.post("/seforall/counters", cors(cors_config), async function (req, res, next) {
    const counterName = req.body.counterName;
    const environment = req.body.source;
    let documentId;
    try {
        switch (environment) {
            case 'dev':
                documentId = "fccc1077e8d67c01890c3edfb4e98265"
                break;
            case 'test':
                documentId = "5bf10a35690d5c077254261a64e238ed";
                break;
            default:
                documentId = "d7987f26d091d9713b73a399ec2aad87";
                break;
        }
        const docResponse = await cloudantClientUI.getDocument({
            db: 'counters_db',
            docId: documentId
        });
        const doc = docResponse.result;
        if (counterName === 'search_area_counter') {
            doc.search_area_counter++;
        } else if (counterName === 'uniq_user_counter') {
            doc.uniq_user_counter++;
        } else {
            return res.status(400).json({error: 'Bad counter name'});
        }

        const updateDocResponse = cloudantClientUI.putDocument({
            db: 'counters_db',
            docId: doc._id,
            document: doc
        });
        res.json(updateDocResponse.result);
    } catch (error) {
        res.status(500).json({error: 'Error'});
    }
});
app.post("/seforall/stats", cors(cors_config), async function (req, res, next) {
    let doc = {};
    doc.date = new Date().toISOString();
    doc.country = req.body.country;
    doc.county = req.body.countyName;
    let saveDoc = cloudantClientUI.postDocument({
        db: "counties_db",
        document: doc,
    }).then((response) => {
        console.log('Document saved: Response ' + response.result.id);
    })
        .catch((error) => {
            console.log('Error raised during saving document to DB: ' + error);
        })
});
// retrieve the existing polygonCoordinates
app.post("/seforall/coordinates", cors(cors_config), function (req, res, next) {
    // Extract the JSON string from the request body
    const coordinatesJSONString = Object.keys(req.body)[0];
    const coordinatesObject = JSON.parse(coordinatesJSONString);

    // Extract the 'coordinates' array from the parsed object
    const coordinates = coordinatesObject.coordinates;

    const selector = {
        "coordinates": coordinates
    };

    cloudantClientUI.postFind({
        db: placesName,
        selector: selector,
        fields: [
            '_id'
        ],
    }).then(response => {
        if (response.result.docs.length > 0) {
            return res.json({ exists: true });
        } else {
            return res.json({ exists: false });
        }
    }).catch(error => {
        return res.status(500).json({
            err: 'Error occured',
            message: error.body
        });
    });
});
// retrieve the existing entries
app.get("/seforall/entries", cors(cors_config), function (req, res, next) {
    return cloudantClientUI.postAllDocs({
        db: placesName,
        includeDocs: true,
    })
        .then(allDocuments => {
            let fetchedEntries = allDocuments.result;
            let entries = {
                entries: fetchedEntries.rows.map((row) => {
                    return {
                        _id: row.doc._id,
                        coordinates: row.doc.coordinates,
                        place: row.doc.place,
                        geoJson_url: row.doc.geoJson_url,
                        count_of_buildings: row.doc.count_of_buildings,
                        count_of_buildings_res: row.doc.count_of_buildings_res,
                        count_of_buildings_nonRes: row.doc.count_of_buildings_nonRes,
                        square_area: row.doc.square_area,
                        square_area_res: row.doc.square_area_res,
                        square_area_nonRes: row.doc.square_area_nonRes,
                        model_confidence_res: row.doc.model_confidence_res,
                        model_confidence_nonRes: row.doc.model_confidence_nonRes,
                        height_avg: row.doc.height_avg,
                        height_avg_res: row.doc.height_avg_res,
                        height_avg_nonRes: row.doc.height_avg_nonRes,
                        createdAt: row.doc.createdAt
                    }
                })
            }
            console.log('Documents loaded!');
            return res.json(entries);
        })
        .catch(error => {
            console.log('Error raised during loading documents from DB, ' + error.body);
            return res.status(500).json({
                message: error.body
            });
        });
});

app.get("/seforall/notifications", cors(cors_config), async function (req, res, next) {

    var date = new Date();
    var twoDaysAgoDate = date - 1000 * 60 * 60 * 24 * 2;
    var dateLimit = new Date(twoDaysAgoDate).getTime();

    try {
        const docResponse = await cloudantClientUI.postFind({
            db: 'notifications_db',
            selector: {
                "timestamp": { "$gt": dateLimit }
            },
            fields: ["title", "message", "button_text", "button_link", "timestamp"]
        });

        if (docResponse.result?.docs?.length > 0) { 
            res.json(
                docResponse.result?.docs
                .sort((firstDateTimestamp, secondDateTimestamp) => firstDateTimestamp.timestamp - secondDateTimestamp.timestamp)
                .pop()
            );
        } else {
            res.status(204).json();
        }
    } catch (error) {
        res.status(500).json({ error: error });
    }
});

app.get('/', (req, res) => {
    res.send('healthy')
})

// create a new client
const cloudantClientUI = CloudantV1.newInstance({
    authenticator: authenticatorUI,
    serviceUrl: "https://e488e3d1-dc9e-4fe5-ab3a-cc12cf35d4fa-bluemix.cloudantnosqldb.appdomain.cloud"
});

var port = process.env.PORT || 8080
app.listen(port, function () {
    console.log("To view your app, open this link in your browser: http://localhost:" + port);
});

