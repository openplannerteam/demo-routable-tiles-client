var t = require('tiles-in-bbox')
const jsonld = require('jsonld').promises;
const dijkstra = require('dijkstrajs');
const haversine = require('haversine');

class RoutableTilesClient {
  
  constructor () {

  }

  async query (fromLatLong, toLatLong) {

    // the 0.02 margin might still miss out on shortest paths though... We should probably find another way to select the right tiles more dynamically while running Dijkstra...
    var bbox = {
      bottom : fromLatLong[0]-0.02,
      left : fromLatLong[1]-0.02,
      top : toLatLong[0]+0.02,
      right : toLatLong[1]+0.02
    }
    
    var frame = {
      "@context": {
        "geo":"http://www.w3.org/2003/01/geo/wgs84_pos#",
        //    "node":"http://www.openstreetmap.org/node/",
        "osm": "https://w3id.org/openstreetmap/terms#",
        "osm:nodes": {
          "@type":"@id",
          "@container": "@list"
        }
      }
    };

    // hardcoded
    var zoom = 14
    // calculate tiles in bbox
    var tiles = t.tilesInBbox(bbox, zoom)
    var promises = [];

    var nodes = {};
    for (let tile of tiles) {
      let {x,y,z} = tile;
      let url = 'https://tiles.openplanner.team/planet/' + z +'/' + x + '/'+ y + '/';
      console.log(url);
      //Transform the data into something that can be used by a Dijkstra algorithm:
      //Adjecency matrix for nodes
      let vertices = {};
      
      promises.push(jsonld.compact(url, frame).then( (json) => {
        console.error('RETRIEVED ' + url);
        for (let obj of json["@graph"]) {
          if (obj["geo:long"] && !nodes[obj["@id"]]) {
            obj.neighbours = [];
            nodes[obj["@id"]] = obj;
          } else if (obj["@type"] === "osm:Way") {
            //add neighbours to the nodes
            let way = obj;
            let currentId = null;
            for (let nodeId of way["osm:nodes"]) {
              if (currentId) {
                nodes[nodeId].neighbours.push(currentId);
                //also the other way arround
                nodes[currentId].neighbours.push(nodeId);
              }
              currentId = nodeId;
            }
          }
        }
      }), (error) => {
        console.error(error);
      });
    }
    
    //After all tiles are downloaded, we can get working with the nodes
    var findClosestNode = function (nodes, latlong) {
      let min = Infinity;
      let closest = {};
      for (let nodeId in nodes) {
        let node = nodes[nodeId];
        let d = haversine({latitude: node["geo:lat"], longitude: node["geo:long"] }, {latitude: latlong[0], longitude: latlong[1] });
        if (d < min) {
          min = d;
          closest = nodeId;
        }
      }
      return closest;
    };

    return Promise.all(promises).then(() => {
      //Search for the node closest to the lat long of start and destination
      let fromNodeId = findClosestNode(nodes, fromLatLong);
      let toNodeId = findClosestNode(nodes, toLatLong);
      console.error("FROM:", fromNodeId, "TO:", toNodeId);
      
      // ------------  STEP 2: Initiate Dijkstra ------------
      var graph = {};
      for (let nodeId in nodes) {
        let node = nodes[nodeId];
        graph[node["@id"]] = {};
        for (let neighbourId of node.neighbours) {
          let weight = haversine({latitude: node["geo:lat"], longitude: node["geo:long"] }, {latitude: nodes[neighbourId]["geo:lat"], longitude: nodes[neighbourId]["geo:long"]});
          graph[node["@id"]][neighbourId] = weight;
        }
      }
      //console.log(graph);
      var result = dijkstra.find_path(graph, fromNodeId, toNodeId);
      
      // ------------  STEP 3: Output this as GeoJSON------------

      var output = {
        "type": "FeatureCollection",
        "features":[ {
          type: "Feature",
          properties: {},
          geometry : {
            type : "LineString",
            coordinates: result.map((nodeId) => {
              let node = nodes[nodeId];
              return [node["geo:long"], node["geo:lat"]]
            })
          }
        }]
      };
      return output;
    });
  }

};

if (window)
  window.RoutableTilesClient = RoutableTilesClient;
module.exports = RoutableTilesClient;
