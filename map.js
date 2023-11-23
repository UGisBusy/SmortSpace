//老師寫的糟糕的全域變數
var chart;
var option;

function init(centerCoord) {
  //設定Mapbox的取用Token。
  mapboxgl.accessToken = 'pk.eyJ1IjoiYmlhYm9ibyIsImEiOiJjamVvejdlNXQxZnBuMndtdWhiZHRuaTNpIn0.PIS9wtUxm_rz_IzF2WFD1g';
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
      //以類型分類，station為綠色，path為藍色，charge path為紅色
      categories: ['station', 'path', 'charge path'],
      inRange: {
        color: ['green', 'blue', 'red'],
        opacity: [1, 0.1, 0.1],
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
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'height']],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'min_height']],
          'fill-extrusion-opacity': 0.6,
        },
      },
      labelLayerId
    );
  });
}

function makePath(station, sampleDistance) {
  //兩站點連成線
  let stationLoop = station.concat([station[0]]);
  let line = turf.lineString(stationLoop.map((point) => point.geometry.coordinates));
  //轉成貝氏曲線
  let curve = turf.bezierSpline(line, { sharpness: 0.9 });
  //曲線轉換成大量點
  let allPoints = getPointsOnCurve(curve, stationLoop);
  //取樣，留下站點 + 每sampleDistance取一個點
  let samplePoints = getSamplePoints(allPoints, sampleDistance);
  //將取樣點高度平滑
  let smoothPoints = smoothHeight(samplePoints);
  return smoothPoints;
}

function getPointsOnCurve(curve, stationLoop) {
  //曲線上佈大量點，並將站點插入
  let allPoints = [];
  let stationId = 0;
  let line = turf.lineString([...curve.geometry.coordinates]);
  let chunk = turf.lineChunk(line, 0.0001);
  chunk.features.forEach((point) => {
    point = turf.point(point.geometry.coordinates[1], { height: 0, type: 'path' });
    if (turf.distance(point, stationLoop[stationId]) <= 0.0001) {
      allPoints.push(stationLoop[stationId++]);
    } else {
      allPoints.push(point);
    }
  });
  return allPoints;
}

function getSamplePoints(points, sampleDistance) {
  //將points的點每sampleDistance長度取樣
  let samplePoints = [points[0]];
  let current = points[0];
  for (let i = 1; i < points.length; i++) {
    next = points[i];
    if (next.properties.type == 'station' || turf.distance(current, next) >= sampleDistance) {
      if (turf.distance(current, next) < sampleDistance) {
        //如果站點離sample裡的上一點太近，取代其為此站點
        samplePoints.pop();
      }
      current = next;
      samplePoints.push(current);
    }
  }
  if (turf.distance(samplePoints[0], samplePoints[samplePoints.length - 1]) < sampleDistance) {
    //如果第一點和最後一點太近，刪除最後一點
    samplePoints.pop();
  }
  return samplePoints;
}

function smoothHeight(points) {
  /*
  將points的點高度平滑化。
  站間的點高度轉化套用平滑函式(sigmoid)，改變速度:緩>急>緩。

  實作細節：
    兩站點間點的數量存起來當 區間數量smoothSize。
    兩站點的高度分別為 起點高度smoothStart、終點高度smoothEnd。
    把sigmoid函式放大到(smoothStart, smoothEnd)，分成smoothSize區間。
    最後把中間第id點的高度設為 sigmoid'(id)。
  */
  let stationIds = [];
  points.forEach((point, index) => {
    if (point.properties.type == 'station') {
      stationIds.push(index);
    }
  });
  stationIds.push(points.length - 1);
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
      //每讀到站點時，設定好下一個區段的平滑函式參數
      lastHeight = getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId);
      smoothStart = points[stationIds[curStationId]].properties.height;
      smoothEnd = points[stationIds[(curStationId + 1) % (stationIds.length - 1)]].properties.height;
      smoothSize = stationIds[curStationId + 1] - stationIds[curStationId];
      smoothId = 0;
      curStationId++;
      if (firstHeight === 0) {
        firstHeight = getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId);
      } else {
        //站點的高度為前後兩點的平均
        point.properties.height = (getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId++) + lastHeight) / 2;
      }
    } else {
      point.properties.height = getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId++);
    }
    newPoints.push(point);
  });
  //第0站點的高度為第1點高度和最後1點高度的平均
  // newPoints[0].properties.height = (getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId++) + firstHeight) / 2;
  return newPoints;
}

function getSmoothValue(start, end, size, id) {
  //sigmoid函式
  let sigmoid = (x) => 1 / (1 + Math.exp(-x));
  let t = id / (size - 1);
  return start + (end - start) * sigmoid(8 * (t - 0.5));
}

function makeDrawData(points) {
  //將點轉換成echarts繪製的格式
  let drawData = [];
  points.forEach((point) => {
    drawData.push({
      name: point.properties.name ? point.properties.name : '',
      //資料改成：[經度, 緯度, 高度, 類型]
      value: [...point.geometry.coordinates, point.properties.height, point.properties.type],
    });
  });
  return drawData;
}

function draw(data) {
  //畫點到echarts上
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

function makeChargePaths(path) {
  //建立每條充電路徑的端點
  let EndpointPairs = [];
  path.forEach((point) => {
    if (point.properties.type == 'station') {
      let ground = turf.point(point.geometry.coordinates, { height: 0, type: 'station' });
      EndpointPairs.push([ground, point]);
    }
  });

  //每條充電路徑每單位加入路徑點
  let stepHeight = 8;
  let paths = [];
  EndpointPairs.forEach((pair) => {
    let path = [];
    let current = pair[0];
    while (current.properties.height < pair[1].properties.height - stepHeight / 2) {
      path.push(current);
      current = turf.point(current.geometry.coordinates, { height: current.properties.height + stepHeight, type: 'charge path' });
    }
    paths.push(path.concat(pair[1]));
  });
  return paths;
}
