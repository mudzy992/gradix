import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/lib/api';

export async function pickCompressedJpeg(): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (picked.canceled || !picked.assets[0]) {
    return null;
  }
  const resized = await ImageManipulator.manipulateAsync(
    picked.assets[0].uri,
    [{ resize: { width: 1920 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
  const form = new FormData();
  form.append('file', {
    uri: resized.uri,
    name: 'photo.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);
  const uploaded = await api<{ path: string }>('/files', { method: 'POST', formData: form });
  return uploaded.path;
}
