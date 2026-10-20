# Ship

Merge de los PRs apilados en este orden: módulo y migración, luego el API, luego la web. El deploy a producción sigue siendo manual y no forma parte de este cambio. La migración 0067 corre con el release que el PO dispare; es aditiva y el default es false. 0065 y 0066 viajan en el journal para no chocar el idx con #795 y #799.
