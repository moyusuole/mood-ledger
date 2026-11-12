/**
 * media.js — 情绪账本媒体存储（图片 / 视频）
 *
 * 记录本身存在 Preferences（单条 JSON，不适合放大文件），所以：
 *   - 媒体二进制单独存到设备文件系统（原生 Android = Filesystem Data 目录）
 *   - Web / 桌面预览回退到 IndexedDB
 *   - 记录里只保存「引用」{ id, type, ext }，不存二进制
 *
 * 纯离线：不依赖任何服务器。
 */
(function (root) {
  'use strict';

  var C = root.Capacitor;
  var NATIVE = !!(C && C.isNativePlatform && C.isNativePlatform());
  var DIR = 'mood_media'; // Filesystem Data 目录下的子文件夹

  var seq = 1;
  function genId() {
    return 'm' + Date.now().toString(36) + (seq++).toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  }
  function refOf(id, type, ext) { return { id: id, type: type, ext: ext }; }

  // ---------- Web：IndexedDB ----------
  var dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open('mood_media_db', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('media', { keyPath: 'id' }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }
  function idbPut(id, blob) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').put({ id: id, blob: blob });
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGet(id) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('media', 'readonly');
        var r = tx.objectStore('media').get(id);
        r.onsuccess = function () { res(r.result ? r.result.blob : null); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function idbDel(id) {
    return openDB().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').delete(id);
        tx.oncomplete = function () { res(); };
      });
    });
  }
  var urlCache = {}; // id -> objectURL（Web 端复用）

  // ---------- 通用工具 ----------
  function fileToBase64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(',')[1]); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(file);
    });
  }
  function dataUrlToBase64(d) { return String(d).split(',')[1]; }

  var EXT_WHITE = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'm4v', '3gp'];
  function detectExt(file, type) {
    if (file && file.name && /\.[a-z0-9]+$/i.test(file.name)) {
      var e = file.name.split('.').pop().toLowerCase();
      if (EXT_WHITE.indexOf(e) >= 0) return e === 'jpeg' ? 'jpg' : e;
    }
    var t = (file && file.type) || type || '';
    if (t.indexOf('png') >= 0) return 'png';
    if (t.indexOf('gif') >= 0) return 'gif';
    if (t.indexOf('webp') >= 0) return 'webp';
    if (t.indexOf('mp4') >= 0) return 'mp4';
    if (t.indexOf('mov') >= 0) return 'mov';
    if (t.indexOf('quicktime') >= 0) return 'mov';
    if (t.indexOf('webm') >= 0) return 'webm';
    return 'jpg';
  }

  // 图片自动缩小到最长边 1600px 以内，省空间（视频不动）
  function maybeDownscale(file) {
    return new Promise(function (res) {
      if (!/^image\//.test(file.type) || typeof Image === 'undefined' || typeof document === 'undefined') { res(file); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.width, h = img.height;
        if (!w || !h || (w <= max && h <= max)) { URL.revokeObjectURL(url); res(file); return; }
        var scale = Math.min(1, max / Math.max(w, h));
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        try { canvas.getContext('2d').drawImage(img, 0, 0, cw, ch); } catch (e) { URL.revokeObjectURL(url); res(file); return; }
        URL.revokeObjectURL(url);
        var outType = (file.type && file.type.indexOf('png') >= 0) ? 'image/png' : 'image/jpeg';
        canvas.toBlob(function (blob) {
          if (!blob) { res(file); return; }
          try {
            var name = (file.name || 'img.jpg').replace(/\.[^.]+$/, outType === 'image/png' ? '.png' : '.jpg');
            res(new File([blob], name, { type: outType }));
          } catch (e) { res(file); }
        }, outType, 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }

  function fs() { return C.Plugins.Filesystem; }
  function pathOf(ref) { return DIR + '/' + ref.id + '.' + ref.ext; }

  var MediaStore = {
    isNative: NATIVE,

    // file: File/Blob -> Promise<ref>
    save: function (file) {
      var type = /^video\//.test(file.type) ? 'video' : 'image';
      var ext = detectExt(file, file.type);
      var id = genId();
      if (NATIVE) {
        return maybeDownscale(file)
          .then(function (f) { return fileToBase64(f); })
          .then(function (b64) { return fs().writeFile({ path: pathOf(refOf(id, type, ext)), data: b64, directory: 'DATA', recursive: true }); })
          .then(function () { return refOf(id, type, ext); })
          .catch(function (e) { return Promise.reject(e); });
      }
      return maybeDownscale(file).then(function (f) { return idbPut(id, f).then(function () { return refOf(id, type, ext); }); });
    },

    // base64（无 data: 前缀）-> Promise<ref>，用于导入还原
    saveFromBase64: function (b64, type, ext) {
      var id = genId();
      if (NATIVE) {
        return fs().writeFile({ path: pathOf(refOf(id, type, ext)), data: b64, directory: 'DATA', recursive: true })
          .then(function () { return refOf(id, type, ext); });
      }
      var mime = (type === 'video' ? 'video/' : 'image/') + (ext === 'jpg' ? 'jpeg' : ext);
      var bin = atob(b64), len = bin.length, arr = new Uint8Array(len);
      for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
      return idbPut(id, new Blob([arr], { type: mime })).then(function () { return refOf(id, type, ext); });
    },

    // 取可显示的 URL
    getUrl: function (ref) {
      if (!ref || !ref.id) return Promise.resolve('');
      if (NATIVE) {
        return fs().getUri({ path: pathOf(ref), directory: 'DATA' })
          .then(function (r) { return C.convertFileSrc ? C.convertFileSrc(r.uri) : r.uri; })
          .catch(function () { return ''; });
      }
      if (urlCache[ref.id]) return Promise.resolve(urlCache[ref.id]);
      return idbGet(ref.id).then(function (blob) {
        if (!blob) return '';
        var u = URL.createObjectURL(blob);
        urlCache[ref.id] = u;
        return u;
      });
    },

    // 取 base64（无前缀）用于导出，视频也支持
    getBase64: function (ref) {
      if (!ref || !ref.id) return Promise.resolve('');
      if (NATIVE) {
        return fs().readFile({ path: pathOf(ref), directory: 'DATA' }).then(function (r) { return r.data || ''; }).catch(function () { return ''; });
      }
      return idbGet(ref.id).then(function (blob) {
        if (!blob) return '';
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res(dataUrlToBase64(fr.result)); };
          fr.onerror = function () { res(''); };
          fr.readAsDataURL(blob);
        });
      });
    },

    remove: function (ref) {
      if (!ref || !ref.id) return Promise.resolve();
      if (NATIVE) return fs().deleteFile({ path: pathOf(ref), directory: 'DATA' }).catch(function () {});
      if (urlCache[ref.id]) { URL.revokeObjectURL(urlCache[ref.id]); delete urlCache[ref.id]; }
      return idbDel(ref.id);
    },

    removeMany: function (refs) {
      if (!refs || !refs.length) return Promise.resolve();
      return Promise.all(refs.map(function (r) { return MediaStore.remove(r); }));
    }
  };

  root.MoodMedia = MediaStore;
  if (typeof module !== 'undefined' && module.exports) module.exports = MediaStore;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
