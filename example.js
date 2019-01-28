#!/usr/bin/env node
// ------------  STEP 0: Configure a query ------------

var fromLatLong = [51.02535, 3.71926];
var toLatLong = [51.04888,3.72879];

// ------------  STEP 1: Download Nodes and have  a list of their neighbours ------------
const Client = require('./lib/routable-tiles-client.js');

var client = new Client();

client.query(fromLatLong,toLatLong).then((result) => {
    console.log(JSON.stringify(result));
});
