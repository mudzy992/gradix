import { NotificationsService } from '../../modules/notifications/notifications.service';
import { isInsideGeofence } from '../../common/geo/haversine';

type GeoProject = {
  id: string;
  name: string;
  lat: { toString(): string } | null;
  lng: { toString(): string } | null;
  geofenceRadius: number;
};

export async function notifyGeofenceTransitions(input: {
  notifications: NotificationsService;
  actorId: string;
  companyId: string;
  lat: number;
  lng: number;
  prevLat: number | null;
  prevLng: number | null;
  projects: GeoProject[];
}): Promise<void> {
  for (const project of input.projects) {
    if (project.lat == null || project.lng == null) {
      continue;
    }
    const centerLat = Number(project.lat);
    const centerLng = Number(project.lng);
    const inside = isInsideGeofence({
      lat: input.lat,
      lng: input.lng,
      centerLat,
      centerLng,
      radiusM: project.geofenceRadius,
    });
    const wasInside =
      input.prevLat != null &&
      input.prevLng != null &&
      isInsideGeofence({
        lat: input.prevLat,
        lng: input.prevLng,
        centerLat,
        centerLng,
        radiusM: project.geofenceRadius,
      });
    if (inside === wasInside) {
      continue;
    }
    await input.notifications.createForUser({
      companyId: input.companyId,
      userId: input.actorId,
      type: inside ? 'GEOFENCE_ENTER' : 'GEOFENCE_EXIT',
      title: inside ? 'Geofence enter' : 'Geofence exit',
      message: project.name,
      data: { projectId: project.id },
    });
  }
}
