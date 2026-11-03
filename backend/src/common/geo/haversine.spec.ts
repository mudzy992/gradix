import { distanceMeters, isInsideGeofence } from './haversine';

describe('haversine (BE-12)', () => {
  // Sarajevo i Mostar: stvarna udaljenost po vazduhu ~ 78 km.
  const SARAJEVO = { lat: 43.8563, lng: 18.4131 };
  const MOSTAR = { lat: 43.3438, lng: 17.8078 };

  it('računa poznatu udaljenost Sarajevo–Mostar (~78 km)', () => {
    const meters = distanceMeters(
      SARAJEVO.lat,
      SARAJEVO.lng,
      MOSTAR.lat,
      MOSTAR.lng,
    );
    expect(meters).toBeGreaterThan(74_000);
    expect(meters).toBeLessThan(82_000);
  });

  it('ista tačka = 0 m, a udaljenost je simetrična', () => {
    expect(distanceMeters(43.85, 18.41, 43.85, 18.41)).toBe(0);
    expect(distanceMeters(43.85, 18.41, 44.2, 17.9)).toBeCloseTo(
      distanceMeters(44.2, 17.9, 43.85, 18.41),
      6,
    );
  });

  it('radi preko 180. meridijana i na polovima', () => {
    const across = distanceMeters(0, 179.999, 0, -179.999);
    expect(across).toBeGreaterThan(0);
    expect(across).toBeLessThan(1_000);
    // od pola do pola ~ pola obima Zemlje
    const poleToPole = distanceMeters(90, 0, -90, 0);
    expect(poleToPole / 1_000).toBeCloseTo(20_015, -1);
  });

  it('geofence je inkluzivan na samoj granici i poštuje radijus', () => {
    const radiusM = 500;
    const center = { lat: 43.8563, lng: 18.4131 };
    const edgeDistance = distanceMeters(
      center.lat,
      center.lng,
      center.lat,
      center.lng + 0.005,
    );
    // tačka na ~427 m je unutra, a na ~853 m van
    expect(edgeDistance).toBeLessThan(radiusM);
    expect(
      isInsideGeofence({
        lat: center.lat,
        lng: center.lng + 0.005,
        centerLat: center.lat,
        centerLng: center.lng,
        radiusM,
      }),
    ).toBe(true);
    expect(
      isInsideGeofence({
        lat: center.lat,
        lng: center.lng + 0.01,
        centerLat: center.lat,
        centerLng: center.lng,
        radiusM,
      }),
    ).toBe(false);
    // radijus 0 ⇒ samo tačno središte
    expect(
      isInsideGeofence({
        lat: center.lat,
        lng: center.lng,
        centerLat: center.lat,
        centerLng: center.lng,
        radiusM: 0,
      }),
    ).toBe(true);
  });
});
