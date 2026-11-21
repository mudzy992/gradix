import { useEffect, useState } from 'react';
import { isOnline } from '@/sync/net';

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      const next = await isOnline();
      if (mounted) {
        setOnline(next);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 8000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);
  return online;
}
