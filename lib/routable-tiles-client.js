var t = require('tiles-in-bbox')
const jsonld = require('jsonld').promises;
const dijkstra = require('dijkstrajs');
const haversine = require('haversine');

class RoutableTilesClient {
  
  constructor () {
    this.graph = {};
    this.nodes = {};
    this.urlsFetched = [];
    this.sharedPromises = [];
  }

  //After all tiles are downloaded, we can get working with the nodes
  findClosestNode (latlong) {
    let min = Infinity;
    let closest = {};
    for (let nodeId in this.nodes) {
      let node = this.nodes[nodeId];
      let d = haversine({latitude: node["geo:lat"], longitude: node["geo:long"] }, {latitude: latlong[0], longitude: latlong[1] });
      if (d < min) {
        min = d;
        closest = nodeId;
      }
    }
    return closest;
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
    for (let tile of tiles) {
      let {x,y,z} = tile;
      let url = 'https://tiles.openplanner.team/planet/' + z +'/' + x + '/'+ y + '/';
      //Transform the data into something that can be used by a Dijkstra algorithm:
      //Adjecency matrix for nodes

      //First check whether we can reuse something
      if (this.urlsFetched.indexOf(url) > -1)
        continue;
      
      if (this.sharedPromises[url]) {
        promises.push(this.sharedPromises[url]);
      } else {
        this.sharedPromises[url] = jsonld.compact(url, frame).then((json) => {
          this.urlsFetched.push(url);
          for (let obj of json["@graph"]) {
            if (obj["geo:long"] && !this.nodes[obj["@id"]]) {
              obj.neighbours = [];
              this.nodes[obj["@id"]] = obj;
            } else if (obj["@type"] === "osm:Way") {
              //add neighbours to the nodes
              let way = obj;
              let currentId = null;
              for (let nodeId of way["osm:nodes"]) {
                if (currentId) {
                  this.nodes[nodeId].neighbours.push(currentId);
                  //also the other way arround (unless it’s a one way street?)
                  this.nodes[currentId].neighbours.push(nodeId);
                }
                currentId = nodeId;
              }
            }
          }
          delete this.sharedPromises[url];
        }, (error) => {
          delete this.sharedPromises[url];
          console.error(error);
        });
        promises.push(this.sharedPromises[url]);
      }
    }

    return Promise.all(promises).then(() => {
      //Search for the node closest to the lat long of start and destination
      let fromNodeId = this.findClosestNode(fromLatLong);
      let toNodeId = this.findClosestNode(toLatLong);
      console.log("FROM:", fromNodeId, "TO:", toNodeId);
      
      // ------------  STEP 2: Initiate Dijkstra ------------
      for (let nodeId in this.nodes) {
        let node = this.nodes[nodeId];
        this.graph[node["@id"]] = {};
        for (let neighbourId of node.neighbours) {
          let weight = haversine({latitude: node["geo:lat"], longitude: node["geo:long"] }, {latitude: this.nodes[neighbourId]["geo:lat"], longitude: this.nodes[neighbourId]["geo:long"]});
          this.graph[node["@id"]][neighbourId] = weight;
        }
      }
      //console.log(graph);
      var result = dijkstra.find_path(this.graph, fromNodeId, toNodeId);
      
      // ------------  STEP 3: Output this as GeoJSON------------

      var output = {
        "type": "FeatureCollection",
        "features":[ {
          type: "Feature",
          properties: {},
          geometry : {
            type : "LineString",
            coordinates: result.map((nodeId) => {
              let node = this.nodes[nodeId];
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
