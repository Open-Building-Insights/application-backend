const IBM = require('ibm-cos-sdk');
const fs = require('fs');
const path = require('path');

if (process.env.IBM_COS_KEY) {
    ibm_cos_key = process.env.IBM_COS_KEY;
}

// Configuration for IBM COS
const config = {
    endpoint: 's3.eu-de.cloud-object-storage.appdomain.cloud',
    apiKeyId: ibm_cos_key,
    serviceInstanceId: '702bd564-ddd2-48d9-8af8-dab7efff5314',
    signatureVersion: 'iam',
};

const cos = new IBM.S3(config);
const bucketName = 'websitebucket'; // Replace with your COS bucket name
const baseDir = '../frontend'; // Set 'frontend' as the base directory

function uploadFile(filePath, bucketName, key) {
    const fileStream = fs.createReadStream(filePath);

    const contentType = getContentTypeByExtension(filePath);

    return cos.putObject({
        Bucket: bucketName,
        Key: key,
        Body: fileStream,
        ContentType: contentType
    }).promise();
}

function getContentTypeByExtension(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
        case '.html': return 'text/html';
        case '.css':  return 'text/css';
        case '.js':   return 'text/javascript';
        case '.jpg':  return 'image/jpeg';
        case '.png':  return 'image/png';
        case '.webp': return 'image/webp';
        case '.gif':  return 'image/gif';
        case '.json': return 'application/json';
        case '.geojson': return 'application/geo+json';
        case '.svg':  return 'image/svg+xml';
        default:      return 'application/octet-stream';
    }
}

function walkSync(currentDirPath, callback) {
    fs.readdirSync(currentDirPath).forEach((name) => {
        const filePath = path.join(currentDirPath, name);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
            callback(filePath, stat);
        } else if (stat.isDirectory()) {
            walkSync(filePath, callback);
        }
    });
}

walkSync(baseDir, (filePath) => {
    // Create a key that is relative to 'frontend'
    const key = path.relative(baseDir, filePath).replace(/\\/g, '/');
    uploadFile(filePath, bucketName, key)
        .then(() => console.log(`Uploaded ${filePath} as ${key}`))
        .catch((err) => console.error(`Error uploading ${filePath}: ${err}`));
});
