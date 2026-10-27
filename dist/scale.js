// Horizontal and vertical units are deliberately separate. The display keeps
// the original relief, while railway physics uses the labelled metric scale.
export const HEIGHT_METERS=65000;
export const DEFAULT_RADIUS=650000;
export let R=DEFAULT_RADIUS;
export function setPlanetRadius(meters){R=Math.max(65000,Math.min(2600000,Number(meters)||DEFAULT_RADIUS));return R;}
export const displayRadius=height=>1+height/HEIGHT_METERS;
