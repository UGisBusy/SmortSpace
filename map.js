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

function makePath(station, distance, dataHeight) {
  //兩站點連成線
  let stationLoop = station.concat([station[0]]);
  let line = turf.lineString(stationLoop.map((point) => point.geometry.coordinates));
  //轉成貝氏曲線
  let curve = turf.bezierSpline(line, { sharpness: 0.9 });
  //線段分割
  let chunk = turf.lineChunk(curve, distance, { units: 'kilometers', reverse: true });
  //加上屬性後轉成點陣列
  let path = [];
  // chunk.features.forEach((point) => {
  //   path.push(turf.point(point.geometry.coordinates[0], { height: dataHeight, type: 'path' }));
  // });
  curve.geometry.coordinates.forEach((point, id) => {
    if (id % 2 === 0) {
      path.push(turf.point(point, { height: dataHeight, type: 'path' }));
    }
  });
  return path.concat(station);
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
