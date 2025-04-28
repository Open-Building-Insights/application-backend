## DOCKER TAG AND PUSH
1. docker tag <source_image>:<tag> <region>.icr.io/<my_namespace>/<new_image_repo>:<new_tag>
2. docker tag HASH <registry>/web_site:<new_tag>
3. docker push <registry>/web_site:<new_tag>