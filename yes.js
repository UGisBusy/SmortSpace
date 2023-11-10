
// parse json from file
var json = JSON.parse(require('fs').readFileSync('points.json', 'utf8'));

console.log(json);