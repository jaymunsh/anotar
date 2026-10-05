// SDK boundary fixture. This is not a real Google map or a visual reference.
window.__googleMapQA = { maps: 0, fits: 0, paths: [], pans: [], markers: [] };
const qa = window.__googleMapQA;
class MapView {
  constructor(container, options) {
    this.container = container;
    this.zoom = options.zoom;
    qa.maps++;
  }
  fitBounds(bounds) {
    qa.fits++;
    qa.bounds = bounds.points;
  }
  setCenter(position) {
    qa.center = position;
  }
  setZoom(zoom) {
    this.zoom = zoom;
  }
  getZoom() {
    return this.zoom;
  }
  panTo(position) {
    qa.pans.push(position);
  }
}
class LatLngBounds {
  points = [];
  extend(point) {
    this.points.push(point);
  }
}
class Polyline {
  constructor(options) {
    this.options = options;
    qa.paths.push(options);
  }
  setOptions(options) {
    Object.assign(this.options, options);
  }
  setMap(map) {
    this.options.map = map;
  }
}
class AdvancedMarkerElement extends EventTarget {
  constructor(options) {
    super();
    this.gmpClickable = options.gmpClickable;
    qa.markers.push(this);
    this.content = options.content;
    this.map = options.map;
  }
  set map(map) {
    this.mapValue = map;
    if (map) map.container.append(this.content);
    else this.content.remove();
  }
  get map() {
    return this.mapValue;
  }
  setAttribute() {}
}
const event = {
  addListenerOnce(map, name, callback) {
    const timeout = setTimeout(callback, 0);
    return {
      remove() {
        clearTimeout(timeout);
      },
    };
  },
  clearInstanceListeners() {},
};
window.google = {
  maps: {
    importLibrary: async (name) =>
      name === 'maps'
        ? { Map: MapView, Polyline }
        : name === 'core'
          ? { LatLngBounds }
          : { AdvancedMarkerElement },
    event,
    SymbolPath: { FORWARD_CLOSED_ARROW: 'arrow' },
  },
};
const callback = new URL(document.currentScript.src).searchParams.get('callback');
window[callback]();
