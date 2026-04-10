(function () {
  "use strict";

  var COLORS = {
    vuelta1: "#6eb2e8",
    vuelta2: "#2ecc71",
    vuelta3: "#e8c547",
  };

  var containerEl = document.getElementById("cesiumContainer");
  if (!containerEl || typeof Cesium === "undefined") return;

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

  var viewer = new Cesium.Viewer(containerEl, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    /* Evita ImageryLayer.fromWorldImagery() → api.cesium.com (Ion) y el 401 sin token válido */
    baseLayer: false,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    fullscreenButton: true,
    vrButton: false,
    infoBox: false,
    selectionIndicator: false,
    terrain: new Cesium.Terrain(
      Promise.resolve(new Cesium.EllipsoidTerrainProvider())
    ),
  });

  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.add(
    new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        subdomains: "abcd",
        maximumLevel: 19,
        credit: "© OpenStreetMap © CARTO",
      })
    )
  );

  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.skyAtmosphere.show = true;

  function applyFallbackCamera() {
    viewer.resize();
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(10, 22, 16500000),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-0.85),
        roll: 0,
      },
    });
  }

  /* Panel lateral + flex: el canvas puede medir 0×0 al inicio. Doble rAF tras layout.
   No usar zoomTo(entities) con puntos globales: bounding sphere degenerada → crash Cesium. */
  applyFallbackCamera();
  requestAnimationFrame(function () {
    requestAnimationFrame(applyFallbackCamera);
  });

  function flyHomeLikeToolbar() {
    try {
      viewer.resize();
      if (
        viewer.scene &&
        viewer.scene.camera &&
        typeof viewer.scene.camera.flyHome === "function"
      ) {
        viewer.scene.camera.flyHome(0);
      }
    } catch (ignore) {
      /* flyHome puede fallar si el visor aún no está listo */
    }
  }

  setTimeout(flyHomeLikeToolbar, 280);
  setTimeout(flyHomeLikeToolbar, 950);

  function resizeViewerSoon() {
    setTimeout(function () {
      viewer.resize();
    }, 50);
    setTimeout(function () {
      viewer.resize();
    }, 320);
  }

  window.addEventListener("resize", resizeViewerSoon);

  var cesiumColumnEl = containerEl.parentElement;
  if (cesiumColumnEl && typeof ResizeObserver !== "undefined") {
    var cesiumResizeObserver = new ResizeObserver(function () {
      resizeViewerSoon();
    });
    cesiumResizeObserver.observe(cesiumColumnEl);
  }

  var selectedRec = null;
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
    if (wasOpen) resizeViewerSoon();
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
    resizeViewerSoon();
    if (videoModalCloseEl) videoModalCloseEl.focus();
  }

  function setPointStyle(rec, selected) {
    var e = rec.entity;
    var pt = e.point;
    if (!pt) return;
    var c = Cesium.Color.fromCssColorString(rec.color);
    var show = rec._filterVisible !== false;
    e.show = show;
    if (!show) return;
    pt.pixelSize = selected ? 12 : 8;
    pt.color = c.withAlpha(selected ? 0.92 : 0.62);
    pt.outlineColor = Cesium.Color.WHITE.withAlpha(selected ? 0.95 : 0.72);
    pt.outlineWidth = selected ? 2.5 : 1.5;
  }

  function resetPanel() {
    if (selectedRec) {
      setPointStyle(selectedRec, false);
      selectedRec = null;
    }
    if (titleEl) titleEl.textContent = "Selecciona un punto en el mapa";
    if (metaEl) {
      metaEl.textContent =
        "Filtra por vuelta o país. Haz clic en un punto del globo para ver la ubicación y el vídeo.";
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

  function applyFilters() {
    var v = filterVueltaEl ? filterVueltaEl.value : "";
    var p = filterPaisEl ? filterPaisEl.value : "";
    allMarkers.forEach(function (rec) {
      var okV = !v || String(rec.temporada) === v;
      var okP = !p || rec.paisFiltro === p;
      var show = okV && okP;
      var wasSel = selectedRec === rec;
      if (!show && wasSel) {
        resetPanel();
      }
      rec._filterVisible = show;
      var isSel = selectedRec === rec;
      setPointStyle(rec, isSel);
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

  function addEntitiesForTrip(items, tripKey, color, temporadaNum) {
    if (!Array.isArray(items)) return;
    items.forEach(function (item) {
      var lat = Number(item.lat);
      var lng = Number(item.lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;

      var paisStr = String(item.pais != null ? item.pais : "Punto");
      var paisFiltro = paísSoloParaFiltro(paisStr);
      var c = Cesium.Color.fromCssColorString(color);

      /* Altura 0 sobre el elipsoide WGS84 (HeightReference.NONE por defecto).
       CLAMP_TO_GROUND hacía que en vista 2D de Cesium los puntos no encajaran como en 3D.
       Sin disableDepthTestDistance → sin fantasmas en la cara oculta del globo. */
      var entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lng, lat, 0),
        point: {
          pixelSize: 9,
          color: c.withAlpha(0.62),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.72),
          outlineWidth: 1.5,
        },
        name: "PLEX · " + paisStr,
      });

      var rec = {
        entity: entity,
        temporada: temporadaNum,
        pais: paisStr,
        paisFiltro: paisFiltro,
        item: item,
        color: color,
        _filterVisible: true,
      };
      entity.plexRec = rec;
      allMarkers.push(rec);
    });
  }

  var handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(function (click) {
    var picked = viewer.scene.pick(click.position);
    if (!Cesium.defined(picked) || !picked.id || !picked.id.plexRec) {
      return;
    }
    var rec = picked.id.plexRec;
    if (selectedRec) {
      setPointStyle(selectedRec, false);
    }
    selectedRec = rec;
    setPointStyle(rec, true);
    showVideoInPanel(rec.item, rec.temporada);
    syncVideoSelectToRec(rec);
    resizeViewerSoon();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  fetch("data.json")
    .then(function (r) {
      if (!r.ok) throw new Error("No se pudo cargar data.json");
      return r.json();
    })
    .then(function (data) {
      allMarkers = [];
      fillPaisOptions(data);
      addEntitiesForTrip(data.vuelta1, "vuelta1", COLORS.vuelta1, temporadaForKey("vuelta1"));
      addEntitiesForTrip(data.vuelta2, "vuelta2", COLORS.vuelta2, temporadaForKey("vuelta2"));
      addEntitiesForTrip(data.vuelta3, "vuelta3", COLORS.vuelta3, temporadaForKey("vuelta3"));
      applyFilters();
      resizeViewerSoon();
      applyFallbackCamera();
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          applyFallbackCamera();
          resizeViewerSoon();
        });
      });
      setTimeout(flyHomeLikeToolbar, 350);
      setTimeout(flyHomeLikeToolbar, 1100);
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
        if (selectedRec) {
          setPointStyle(selectedRec, false);
        }
        selectedRec = rec;
        setPointStyle(rec, true);
        showVideoInPanel(rec.item, rec.temporada);
        var ft = viewer.flyTo({ destination: rec.entity, duration: 0.85 });
        if (ft && typeof ft.then === "function") {
          ft.then(function () {
            resizeViewerSoon();
          }).catch(function () {
            resizeViewerSoon();
          });
        } else {
          resizeViewerSoon();
        }
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
