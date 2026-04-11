(function () {
  "use strict";

  var COLORS = {
    vuelta1: "#6eb2e8",
    vuelta2: "#2ecc71",
    vuelta3: "#e8c547",
  };

  var MAP_CENTER = [20, 0];
  var MAP_ZOOM = 2;

  var mapEl = document.getElementById("map");
  if (!mapEl) return;

  var titleEl = document.getElementById("video-panel-title");
  var metaEl = document.getElementById("video-panel-meta");
  var placeholderEl = document.getElementById("video-placeholder");
  var iframeEl = document.getElementById("yt-embed");
  var panelVideoFrameEl = document.querySelector(".video-panel__frame");
  var modalVideoFrameEl = document.querySelector(".video-modal__frame");
  var expandBtnEl = document.getElementById("video-expand-btn");
  var videoModalEl = document.getElementById("video-modal");
  var videoModalCloseEl = document.getElementById("video-modal-close");
  var videoModalBackdropEl = document.getElementById("video-modal-backdrop");
  var openYtEl = document.getElementById("video-open-yt");
  var ytActionsEl = document.getElementById("video-panel-actions");
  var filterVueltaEl = document.getElementById("filter-vuelta");
  var filterPaisEl = document.getElementById("filter-pais");
  var filterVideoEl = document.getElementById("filter-video");
  var resetFiltersEl = document.getElementById("filter-reset");

  var map = L.map(mapEl, {
    worldCopyJump: true,
    minZoom: 2,
    maxBounds: [
      [-85, -200],
      [85, 200],
    ],
  }).setView(MAP_CENTER, MAP_ZOOM);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(map);

  function invalidateMapSoon() {
    setTimeout(function () {
      map.invalidateSize();
    }, 50);
    setTimeout(function () {
      map.invalidateSize();
    }, 320);
  }

  window.addEventListener("resize", invalidateMapSoon);

  var mapColumnEl = mapEl.parentElement;
  if (mapColumnEl && typeof ResizeObserver !== "undefined") {
    var mapResizeObserver = new ResizeObserver(function () {
      invalidateMapSoon();
    });
    mapResizeObserver.observe(mapColumnEl);
  }

  var selectedMarker = null;
  var allMarkers = [];

  function temporadaForKey(key) {
    if (key === "vuelta1") return 1;
    if (key === "vuelta2") return 2;
    if (key === "vuelta3") return 3;
    return null;
  }

  function youtubeIdFromUrl(url) {
    if (!url || typeof url !== "string") return null;
    var m = url.match(/[?&]v=([^&]+)/);
    if (m) return m[1];
    m = url.match(/youtu\.be\/([^?]+)/);
    if (m) return m[1];
    m = url.match(/youtube\.com\/embed\/([^?]+)/);
    if (m) return m[1];
    return null;
  }

  /** Igual que en el build: trocea por comas fuera de paréntesis. */
  function splitEtiquetaPaises(cell) {
    cell = String(cell || "").trim();
    if (!cell) return [];
    var depth = 0;
    var parts = [];
    var buf = [];
    for (var i = 0; i < cell.length; i++) {
      var ch = cell[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(buf.join("").trim());
        buf = [];
      } else {
        buf.push(ch);
      }
    }
    if (buf.length) parts.push(buf.join("").trim());
    return parts.filter(Boolean);
  }

  /** País usado solo en el filtro (último segmento; sin prefijos tipo «Trailer ·»). */
  function paísSoloParaFiltro(etiqueta) {
    var s = String(etiqueta || "").trim();
    if (!s) return "";
    s = s.replace(/^Trailer\s*·\s*/i, "").trim();
    s = s.replace(/^Sin fila en tabla\s*·\s*/i, "").trim();
    s = s.replace(/^Vídeo privado\s*·\s*/i, "").trim();
    var parts = splitEtiquetaPaises(s);
    if (parts.length) return parts[parts.length - 1].trim();
    return s;
  }

  function dockIframeInPanel() {
    if (!iframeEl || !panelVideoFrameEl || !modalVideoFrameEl) return;
    if (modalVideoFrameEl.contains(iframeEl)) {
      panelVideoFrameEl.appendChild(iframeEl);
    }
  }

  function closeVideoModal() {
    if (!videoModalEl) return;
    var wasOpen = !videoModalEl.hidden;
    videoModalEl.hidden = true;
    document.body.style.overflow = "";
    dockIframeInPanel();
    if (wasOpen) invalidateMapSoon();
  }

  function openVideoModal() {
    if (!iframeEl || !modalVideoFrameEl || !panelVideoFrameEl || !videoModalEl) return;
    var src =
      iframeEl.getAttribute("src") ||
      (iframeEl.src && !/^about:blank/i.test(iframeEl.src) ? iframeEl.src : "");
    if (!src) return;
    modalVideoFrameEl.appendChild(iframeEl);
    videoModalEl.hidden = false;
    document.body.style.overflow = "hidden";
    invalidateMapSoon();
    if (videoModalCloseEl) videoModalCloseEl.focus();
  }

  function resetPanel() {
    if (selectedMarker) {
      setMarkerSelected(selectedMarker.m, selectedMarker.c, false);
      selectedMarker = null;
    }
    if (titleEl) titleEl.textContent = "Selecciona un punto en el mapa";
    if (metaEl) {
      metaEl.textContent =
        "Filtra por vuelta o país. Haz clic en un punto del mapa para ver el vídeo.";
    }
    if (iframeEl) {
      iframeEl.removeAttribute("src");
      iframeEl.classList.add("is-hidden");
    }
    if (placeholderEl) placeholderEl.classList.remove("is-hidden");
    if (ytActionsEl) ytActionsEl.hidden = true;
    if (expandBtnEl) expandBtnEl.hidden = true;
    closeVideoModal();
  }

  function showVideoInPanel(item, temporadaDefault) {
    var pais = item.pais != null ? String(item.pais) : "—";
    var temporada =
      item.temporada != null ? item.temporada : temporadaDefault != null ? temporadaDefault : "—";
    var url = item.url != null ? String(item.url) : "";

    if (titleEl) titleEl.textContent = pais;
    if (metaEl) {
      var meta = "Vuelta " + String(temporada);
      if (
        pais.indexOf("itinerario aprox.") !== -1 ||
        pais.indexOf("región aprox.") !== -1
      ) {
        meta += " · En la Vuelta 2 el mapa agrupa días por región del viaje.";
      }
      metaEl.textContent = meta;
    }

    var vid = youtubeIdFromUrl(url);
    if (vid && iframeEl) {
      iframeEl.src = "https://www.youtube.com/embed/" + vid + "?rel=0";
      iframeEl.classList.remove("is-hidden");
      if (placeholderEl) placeholderEl.classList.add("is-hidden");
      if (expandBtnEl) expandBtnEl.hidden = false;
    } else if (iframeEl) {
      iframeEl.removeAttribute("src");
      iframeEl.classList.add("is-hidden");
      if (placeholderEl) placeholderEl.classList.remove("is-hidden");
      if (expandBtnEl) expandBtnEl.hidden = true;
    }

    if (openYtEl && ytActionsEl) {
      if (url && url !== "#") {
        openYtEl.href = url;
        ytActionsEl.hidden = false;
      } else {
        ytActionsEl.hidden = true;
      }
    }
  }

  function setMarkerSelected(marker, color, selected) {
    marker.setStyle({
      radius: selected ? 8 : 5,
      weight: selected ? 2.5 : 1.5,
      color: color,
      fillColor: color,
      fillOpacity: selected ? 0.92 : 0.62,
    });
  }

  function applyFilters() {
    var v = filterVueltaEl ? filterVueltaEl.value : "";
    var p = filterPaisEl ? filterPaisEl.value : "";
    allMarkers.forEach(function (rec) {
      var okV = !v || String(rec.temporada) === v;
      var okP = !p || rec.paisFiltro === p;
      var show = okV && okP;
      var wasSel = selectedMarker && selectedMarker.m === rec.marker;
      if (!show && wasSel) {
        resetPanel();
      }
      var isSelectedNow = selectedMarker && selectedMarker.m === rec.marker;
      var fillOp = !show ? 0 : isSelectedNow ? 0.92 : 0.62;
      var radius = !show ? 5 : isSelectedNow ? 8 : 5;
      var weight = !show ? 1.5 : isSelectedNow ? 2.5 : 1.5;
      rec.marker.setStyle({
        opacity: show ? 1 : 0,
        fillOpacity: fillOp,
        color: rec.color,
        fillColor: rec.color,
        weight: weight,
        radius: radius,
      });
      rec.marker.options.interactive = show;
    });
    fillVideoOptionsAfterFilters();
  }

  function fillVideoOptionsAfterFilters() {
    if (!filterVideoEl) return;
    var v = filterVueltaEl ? filterVueltaEl.value : "";
    var p = filterPaisEl ? filterPaisEl.value : "";
    var cur = filterVideoEl.value;
    filterVideoEl.innerHTML = '<option value="">Vídeo…</option>';
    allMarkers.forEach(function (rec, idx) {
      var okV = !v || String(rec.temporada) === v;
      var okP = !p || rec.paisFiltro === p;
      if (!okV || !okP) return;
      var tit = rec.item.titulo != null ? String(rec.item.titulo) : "Vídeo";
      var opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = tit.length > 90 ? tit.slice(0, 87) + "…" : tit;
      filterVideoEl.appendChild(opt);
    });
    if (
      cur &&
      Array.prototype.some.call(filterVideoEl.options, function (o) {
        return o.value === cur;
      })
    ) {
      filterVideoEl.value = cur;
    } else {
      if (cur) resetPanel();
      filterVideoEl.value = "";
    }
  }

  function syncVideoSelectToRec(rec) {
    if (!filterVideoEl || !rec) return;
    var v = filterVueltaEl ? filterVueltaEl.value : "";
    var p = filterPaisEl ? filterPaisEl.value : "";
    var okV = !v || String(rec.temporada) === v;
    var okP = !p || rec.paisFiltro === p;
    if (!okV || !okP) return;
    var idx = allMarkers.indexOf(rec);
    if (idx >= 0) filterVideoEl.value = String(idx);
  }

  function fillPaisOptions(data) {
    if (!filterPaisEl) return;
    var set = {};
    ["vuelta1", "vuelta2", "vuelta3"].forEach(function (key) {
      (data[key] || []).forEach(function (item) {
        var pa = item.pais != null ? String(item.pais) : "";
        var solo = paísSoloParaFiltro(pa);
        if (solo) set[solo] = true;
      });
    });
    var list = Object.keys(set).sort(function (a, b) {
      return a.localeCompare(b, "es", { sensitivity: "base" });
    });
    var cur = filterPaisEl.value;
    filterPaisEl.innerHTML = '<option value="">Todos</option>';
    list.forEach(function (pa) {
      var opt = document.createElement("option");
      opt.value = pa;
      opt.textContent = pa;
      filterPaisEl.appendChild(opt);
    });
    if (cur && list.indexOf(cur) !== -1) {
      filterPaisEl.value = cur;
    }
  }

  function addMarkersForTrip(items, tripKey, color, temporadaNum) {
    if (!Array.isArray(items)) return;
    items.forEach(function (item) {
      var lat = Number(item.lat);
      var lng = Number(item.lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;

      var paisStr = String(item.pais != null ? item.pais : "Punto");
      var paisFiltro = paísSoloParaFiltro(paisStr);

      var marker = L.circleMarker([lat, lng], {
        radius: 5,
        color: color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.62,
      }).addTo(map);

      var rec = {
        marker: marker,
        temporada: temporadaNum,
        pais: paisStr,
        paisFiltro: paisFiltro,
        item: item,
        color: color,
      };
      allMarkers.push(rec);

      marker.on("click", function () {
        if (selectedMarker) {
          setMarkerSelected(selectedMarker.m, selectedMarker.c, false);
        }
        selectedMarker = { m: marker, c: color };
        setMarkerSelected(marker, color, true);
        showVideoInPanel(item, temporadaNum);
        syncVideoSelectToRec(rec);
      });

      marker.bindTooltip("@YOSOYPLEX · " + paisStr, {
        sticky: true,
        direction: "top",
        opacity: 0.95,
        className: "plex-map-tooltip",
      });
    });
  }

  fetch("data.json")
    .then(function (r) {
      if (!r.ok) throw new Error("No se pudo cargar data.json");
      return r.json();
    })
    .then(function (data) {
      allMarkers = [];
      fillPaisOptions(data);
      addMarkersForTrip(data.vuelta1, "vuelta1", COLORS.vuelta1, temporadaForKey("vuelta1"));
      addMarkersForTrip(data.vuelta2, "vuelta2", COLORS.vuelta2, temporadaForKey("vuelta2"));
      addMarkersForTrip(data.vuelta3, "vuelta3", COLORS.vuelta3, temporadaForKey("vuelta3"));
      applyFilters();
      invalidateMapSoon();
    })
    .catch(function (err) {
      console.error(err);
      if (metaEl) metaEl.textContent = "Error al cargar los datos del mapa.";
    });

  if (filterVueltaEl) {
    filterVueltaEl.addEventListener("change", applyFilters);
  }
  if (filterPaisEl) {
    filterPaisEl.addEventListener("change", applyFilters);
  }
  if (filterVideoEl) {
    filterVideoEl.addEventListener("change", function () {
      var raw = filterVideoEl.value;
      if (!raw) {
        resetPanel();
        applyFilters();
        return;
      }
      var idx = parseInt(raw, 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= allMarkers.length) return;
      var rec = allMarkers[idx];
      var v = filterVueltaEl ? filterVueltaEl.value : "";
      var p = filterPaisEl ? filterPaisEl.value : "";
      if ((!v || String(rec.temporada) === v) && (!p || rec.paisFiltro === p)) {
        if (selectedMarker) {
          setMarkerSelected(selectedMarker.m, selectedMarker.c, false);
        }
        selectedMarker = { m: rec.marker, c: rec.color };
        setMarkerSelected(rec.marker, rec.color, true);
        showVideoInPanel(rec.item, rec.temporada);
        var ll = rec.marker.getLatLng();
        map.setView(ll, Math.max(map.getZoom(), 4));
        invalidateMapSoon();
      }
    });
  }

  if (resetFiltersEl) {
    resetFiltersEl.addEventListener("click", function () {
      if (filterVueltaEl) filterVueltaEl.value = "";
      if (filterPaisEl) filterPaisEl.value = "";
      if (filterVideoEl) filterVideoEl.value = "";
      resetPanel();
      applyFilters();
    });
  }

  if (expandBtnEl) {
    expandBtnEl.addEventListener("click", openVideoModal);
  }
  if (videoModalCloseEl) {
    videoModalCloseEl.addEventListener("click", closeVideoModal);
  }
  if (videoModalBackdropEl) {
    videoModalBackdropEl.addEventListener("click", closeVideoModal);
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && videoModalEl && !videoModalEl.hidden) {
      closeVideoModal();
    }
  });
})();
