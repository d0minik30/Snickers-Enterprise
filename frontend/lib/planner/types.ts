export type LatLon = { lat: number; lon: number }; // degrees, lon -180..180, east positive
export type RouteProfile = 'safest' | 'shortest' | 'flattest';
export type Risk = 'low' | 'medium' | 'high';
export type Hazard = { id: string; center: LatLon; radiusM: number; label: string; source: 'survey' | 'control' };
export type Waypoint = { name: string; distM: number; pos: LatLon }; // distM = distance along the route
export type Route = {
  id: string;
  profile: RouteProfile;
  points: LatLon[];
  elevationM: number[];
  waypoints: Waypoint[];
  lengthM: number;
  maxSlopeDeg: number;
  risk: Risk;
};
