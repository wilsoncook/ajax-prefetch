// 拦截ajax实现prefetch
var interceptAjaxPrefetch = function (whitelist) {
  var XHR = XMLHttpRequest;
  // 预加载列表状态
  var loadStates = {};
  var isPrefetchUrl = function (url) {
    for (var i = 0; i < whitelist.length; i++) {
      var matcher = whitelist[i];
      if (matcher instanceof RegExp ? matcher.test(url) : matcher === url) {
        return true;
      }
    }
    return false;
  };

  // --- 底层ajax拦截
  var open = XHR.prototype.open;
  var send = XHR.prototype.send;
  var pickXhrResult = function (xhr) {
    return {
      readyState: xhr.readyState,
      response: xhr.response,
      responseText: xhr.responseText,
      responseType: xhr
        .responseType, // NOTE: 同步状态下，此属性禁止被覆盖（后面会采用defineProperty来覆盖）
      responseURL: xhr.responseURL,
      responseXML: xhr.responseXML,
      status: xhr.status,
      statusText: xhr.statusText
    };
  };
  var exhaustWaitQueue = function (state) {
    var queue = state.xhrWaitQueue;
    var result = state.xhrResult;
    for (var i = 0; i < queue.length; i++) {
      var xhr = queue[i];
      window.console && console.log('[prefetch]当前"' + xhr._prefetchUrl +
        '"将使用预加载结果进行加速！');
      // 将已完成的结果直接覆盖到新xhr，以便模拟结束
      for (var key in result) {
        Object.defineProperty(xhr, key, {
          value: result[key]
        });
      }
      // 触发回调
      if (xhr.onreadystatechange) {
        xhr.onreadystatechange();
      }
    }
    // 清空当前queue
    state.xhrWaitQueue = [];
  };
  var wrapReadyCallback = function (xhr, callback) {
    var originReady = xhr.onreadystatechange;
    xhr.onreadystatechange = function () {
      // 正常完成
      if (xhr.readyState === 4 && xhr.status === 200) {
        callback();
      }

      if (originReady) {
        originReady.apply(xhr, arguments);
      }
    };
  };

  XHR.prototype.open = function (method, url, async, user, pass) {
    if (isPrefetchUrl(url)) {
      this._prefetchUrl = url;
      this._async = async;
      // 若还未预加载过，则设置预加载状态
      if (!loadStates[url]) {
        loadStates[url] = {
          // 主xhr引用
          xhr: this,
          // 记录主xhr（最初那个xhr）完成的部分状态属性
          xhrResult: null,
          // 当前需要执行结果的queue（场景：当主xhr还没结束时，后续发起的xhr放到这里等待）
          xhrWaitQueue: []
        };
      }
    }

    open.apply(this, arguments);
  };

  XHR.prototype.send = function (data) {
    // 仅针对白名单的url作预加载以及缓存获取
    if (this._prefetchUrl) {
      var state = loadStates[this._prefetchUrl];
      if (state) {
        // 若是主xhr，则执行原请求
        var xhr = state.xhr;
        if (xhr === this) {
          // 完成时以主xhr结果来执行后续请求
          wrapReadyCallback(xhr, function () {
            state.xhrResult = pickXhrResult(xhr);
            exhaustWaitQueue(state);
          });
          // 主xhr发起请求
          send.apply(this, arguments);
        } else {
          // 若上一个请求已完成，直接使用它的结果
          if (state.xhrResult) {
            state.xhrWaitQueue.push(this);
            exhaustWaitQueue(state);
          } else if (!this._async) {
            // 若主请求未完成 && 当前请求是同步请求，则放弃使用主xhr结果，直接发起同步请求
            window.console && console.warn('[prefetch]警告：该"' + this
              ._prefetchUrl + '"请求使用了同步方式，而主xhr还未加载完成，这里将重复发起同步请求以保证业务正常');
            send.apply(this, arguments);
          } else {
            // 主xhr未完成时，直接插入队列
            state.xhrWaitQueue.push(this);
          }
        }
      } else {
        window.console && console.warn('[prefetch]send之前需要先调用open');
      }
    } else {
      // 非预加载，执行原来逻辑
      send.apply(this, arguments);
    }
  };
};
