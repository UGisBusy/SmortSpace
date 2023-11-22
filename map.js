var chart;
var option;

function init(centerCoord) {
  //設定Mapbox的取用Token。
  mapboxgl.accessToken =
    'pk.eyJ1IjoiYmlhYm9ibyIsImEiOiJjamVvejdlNXQxZnBuMndtdWhiZHRuaTNpIn0.PIS9wtUxm_rz_IzF2WFD1g';
  chart = echarts.init(document.getElementById('map'));
  //設定echarts載入mapbox的參數值
  option = {
    mapbox3D: {
      style: 'mapbox://styles/biabobo/cjha51jt70x802rqsorws3xqz',
      center: [centerCoord[1], centerCoord[0]],
      zoom: 16.5,
      pitch: 60,
      altitudeScale: 1,
      shading: 'color',
      postEffect: {
        enable: true,
        SSAO: {
          enable: true,
          radius: 2,
        },
      },
      light: {
        main: {
          intensity: 1,
          shadow: true,
          shadowQuality: 'high',
        },
        ambient: {
          intensity: 0,
        },
      },
    },
    //建立視覺對應顏色規則
    visualMap: {
      type: 'piecewise',
      dimension: 3,
      categories: ['station', 'path'],
      inRange: {
        color: ['green', 'blue'],
        opacity: [1, 0.1],
      },
      seriesIndex: [0, 1],
      itemWidth: 36,
      itemHeight: 26,
      itemGap: 16,
      hoverLink: false,
      left: 20,
      bottom: 50,
      fontSize: 16,
      textStyle: {
        color: 'white',
        fontSize: 16,
      },
    },
  };
}

function makePath(station, sampleDistance, dataHeight) {
  //兩站點連成線
  let stationLoop = station.concat([station[0]]);
  let line = turf.lineString(stationLoop.map((point) => point.geometry.coordinates));
  //轉成貝氏曲線
  let curve = turf.bezierSpline(line, { sharpness: 0.9 });
  //取得曲線上的點、加上站點、補上缺失的部分
  let allPoints = [];
  let stationId = 0;
  curve.geometry.coordinates.forEach((point, index, array) => {
    if (index % 100 === 0) {
      allPoints.push(stationLoop[stationId++]);
    } else {
      allPoints.push(turf.point(point, { height: dataHeight, type: 'path' }));
    }
    if (index % 10 === 9) {
      let nextPoint = array[(index + 1) % array.length];
      let distance = turf.distance(point, nextPoint);
      let chunk = turf.lineChunk(turf.lineString([point, nextPoint]), distance / 12);
      chunk.features.forEach((point) => {
        point = point.geometry.coordinates[1];
        allPoints.push(turf.point(point, { height: dataHeight, type: 'path' }));
      });
    }
  });
  let samplePoints = [allPoints[0]];
  let cur = allPoints[0];
  for (let i = 1; i < allPoints.length; i++) {
    neww = allPoints[i];
    if (neww.properties.type == 'station') {
      cur = neww;
      samplePoints.push(cur);
    } else if (turf.distance(cur, neww) >= sampleDistance) {
      cur = neww;
      samplePoints.push(cur);
    }
  }
  return smooth(samplePoints);
}

function smooth(points) {
  let stationIds = [];
  points.forEach((point, index) => {
    if (point.properties.type == 'station') {
      stationIds.push(index);
    }
  });
  let newPoints = [];
  let curStationId = 0;
  let smoothId = 0;
  let smoothStart = 0;
  let smoothEnd = 0;
  let smoothSize = 0;
  let firstHeight = 0;
  let lastHeight = 0;
  points.forEach((point) => {
    if (point.properties.type == 'station') {
      lastHeight = getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId);
      smoothStart = points[stationIds[curStationId]].properties.height;
      smoothEnd = points[stationIds[(curStationId + 1) % stationIds.length]].properties.height;
      console.log(smoothStart, smoothEnd);
      if (curStationId == stationIds.length - 1) {
        smoothSize = points.length - stationIds[curStationId] + stationIds[0];
      } else {
        smoothSize = stationIds[(curStationId + 1) % stationIds.length] - stationIds[curStationId];
      }
      smoothId = 0;
      curStationId++;
      if (firstHeight === 0) {
        firstHeight = getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId);
      } else {
        point.properties.height =
          (getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId++) + lastHeight) / 2;
      }
      newPoints.push(point);
    } else {
      point.properties.height = getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId++);
      newPoints.push(point);
    }
  });
  newPoints[0].properties.height =
    (getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId++) + firstHeight) / 2;
  return newPoints;
}

function getSmoothValue(start, end, size, id) {
  let sigmoid = (x) => 1 / (1 + Math.exp(-x));
  let t = id / (size - 1);
  return start + (end - start) * sigmoid(5 * (t - 0.5));
}

function drawPoints(points) {
  var data = [];
  points.forEach((point) => {
    data.push({
      name: point.properties.name ? point.properties.name : '',
      value: [...point.geometry.coordinates, point.properties.height, point.properties.type],
    });
  });
  chart.setOption({
    series: [
      {
        name: 'Flight Path Point',
        type: 'scatter3D',
        coordinateSystem: 'mapbox3D',
        symbol: 'circle',
        symbolSize: 10,
        animation: false,
        data: data,
        label: {
          show: false,
        },
      },
    ],
  });
}

//載入地圖
function loadMap() {
  //進行echarts設定，餵入之前定義好的常數-option
  chart.setOption(option, true);
  //從echarts取得mapbox的實體
  var map = chart.getModel().getComponent('mapbox3D')._mapbox;
  //地圖圖資載入完畢後，顯示在Mapbox上的3D建築物圖層。
  map.on('load', function () {
    var layers = map.getStyle().layers;
    var labelLayerId;
    for (var i = 0; i < layers.length; i++) {
      if (layers[i].type === 'symbol' && layers[i].layout['text-field']) {
        labelLayerId = layers[i].id;
        break;
      }
    }
    map.addLayer(
      {
        id: '3d-buildings',
        source: 'composite',
        'source-layer': 'building',
        filter: ['==', 'extrude', 'true'],
        type: 'fill-extrusion',
        minzoom: 15,
        paint: {
          'fill-extrusion-color': '#8EAACB',
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            0,
            15.05,
            ['get', 'height'],
          ],
          'fill-extrusion-base': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            0,
            15.05,
            ['get', 'min_height'],
          ],
          'fill-extrusion-opacity': 0.6,
        },
      },
      labelLayerId
    );
  });
}

var isShowChargePath = false;
function ToggleChargePath() {
  if (isShowChargePath) {
    console.log('ye');
  }
  isShowChargePath = !isShowChargePath;
}
