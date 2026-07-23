// Data hooks (useUserNameMap, useEntityObjects) depend on queryOptions added
// in later slices (usage/detail). useCountUp uses requestAnimationFrame and
// belongs in the views layer (DOM API), not core. This module is filled as
// backing endpoints land.
export {};
