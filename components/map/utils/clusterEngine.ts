import Supercluster from 'supercluster';

// ---------------------------------------------------------------------------
// LOD (Level of Detail) zoom thresholds
// ---------------------------------------------------------------------------

/** Below this zoom: render dots + clusters */
export const LOD_DOTS_MAX_ZOOM = 10;

/** Between LOD_DOTS_MAX_ZOOM and this: render small icons */
export const LOD_ICONS_MAX_ZOOM = 14;

/** Above this zoom: render thumbnails */
export const LOD_THUMBNAILS_MIN_ZOOM = 14;

// ---------------------------------------------------------------------------
// Cluster engine options
// ---------------------------------------------------------------------------

export interface ClusterEngineOptions {
  radius?: number;
  maxZoom?: number;
  minPoints?: number;
}

const DEFAULTS: Required<ClusterEngineOptions> = {
  radius: 60,
  maxZoom: 14,
  minPoints: 3,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createClusterEngine(options?: ClusterEngineOptions) {
  const opts = { ...DEFAULTS, ...options };

  const index = new Supercluster({
    radius: opts.radius,
    maxZoom: opts.maxZoom,
    minPoints: opts.minPoints,
  });

  return {
    /** Load point features into the spatial index. */
    load(features: GeoJSON.Feature<GeoJSON.Point>[]) {
      index.load(features as Supercluster.PointFeature<Record<string, unknown>>[]);
    },

    /** Get clusters and unclustered points within the given bbox at the given zoom. */
    getClusters(bbox: [number, number, number, number], zoom: number) {
      return index.getClusters(bbox, zoom);
    },

    /** Get individual points (leaves) within a cluster. */
    getLeaves(clusterId: number, limit = Infinity) {
      return index.getLeaves(clusterId, limit);
    },

    /** Get the zoom level at which the cluster expands into its children. */
    getClusterExpansionZoom(clusterId: number) {
      return index.getClusterExpansionZoom(clusterId);
    },
  };
}
