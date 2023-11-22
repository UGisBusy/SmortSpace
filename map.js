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
      //以類型分類，station為綠色，path為藍色
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

function makePath(station, sampleDistance) {
  //兩站點連成線
  let stationLoop = station.concat([station[0]]);
  let line = turf.lineString(stationLoop.map((point) => point.geometry.coordinates));
  //轉成貝氏曲線
  let curve = turf.bezierSpline(line, { sharpness: 0.9 });
  //曲線轉換成大量點
  let allPoints = getFullPathOnCurve(curve, stationLoop);
  //取樣，留下站點 + 每sampleDistance取一個點
  let samplePoints = getSamplePoint(allPoints, sampleDistance);
  //將取樣點高度平滑
  let smoothPoints = smoothHeight(samplePoints);
  return smoothPoints;
}

function getFullPathOnCurve(curve, stationLoop) {
  /*
  實作細節：
    取完貝氏曲線，原始的每個線段會分成20分，其中每2個線段裡佈10個點 (一個等分空白，一個等分有10個點)
    每線段「不」等長，有佈點的線段其點的間距也「不」相等。 (垃圾函式庫+我不想手刻)
    => curve的點不均勻

    這個getFullPathOnCurve就是補一堆點到curve上，結果就是一堆很密集但是間距不同的點。
    => 不相等的部分由後來採樣點優化。
    => 想法大概是：這條線上的點超級密，採樣點的時候就去check下一點的距離，如果太近就跳過，讓採樣結果的點和點間幾乎等距。
  */
  let allPoints = [];
  let stationId = 0;
  curve.geometry.coordinates.forEach((point, index, array) => {
    //每100個點是站點
    if (index % 100 === 0) {
      allPoints.push(stationLoop[stationId++]);
    } else {
      allPoints.push(turf.point(point, { height: dataHeight, type: 'path' }));
    }
    //每10個點後是一個空的線段，佈20個點(越密越好)
    if (index % 10 === 9) {
      let nextPoint = array[(index + 1) % array.length];
      let distance = turf.distance(point, nextPoint);
      let chunk = turf.lineChunk(turf.lineString([point, nextPoint]), distance / 22);
      chunk.features.forEach((point) => {
        point = point.geometry.coordinates[1];
        allPoints.push(turf.point(point, { height: dataHeight, type: 'path' }));
      });
    }
  });
  return allPoints;
}

function getSamplePoint(points, sampleDistance) {
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
      smoothSize = stationIds[(curStationId + 1) % stationIds.length] - stationIds[curStationId];
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
  newPoints[0].properties.height = (getSmoothValue(smoothStart, smoothEnd, smoothSize, smoothId++) + firstHeight) / 2;
  return newPoints;
}

function getSmoothValue(start, end, size, id) {
  //sigmoid函式
  let sigmoid = (x) => 1 / (1 + Math.exp(-x));
  let t = id / (size - 1);
  return start + (end - start) * sigmoid(8 * (t - 0.5));
}

function drawPoints(points) {
  //畫點到echarts上
  var data = [];
  points.forEach((point) => {
    data.push({
      name: point.properties.name ? point.properties.name : '',
      //資料改成：[經度, 緯度, 高度, 類型]
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
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'height']],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'min_height']],
          'fill-extrusion-opacity': 0.6,
        },
      },
      labelLayerId
    );
  });
}
