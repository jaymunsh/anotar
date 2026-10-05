import { useEffect, useState } from 'react';
import { localAssetUrl } from '../sync/runtime';
import { subscribeLocalChanges } from '../sync/repository';
export function useAssetUrl(id: string) {
  const [url, setUrl] = useState(id ? `/api/assets/${id}` : '');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!id) {
        setUrl('');
        return;
      }
      void localAssetUrl(id)
        .then((value) => {
          if (active) setUrl(value);
        })
        .catch(() => {});
    };
    refresh();
    const off = subscribeLocalChanges(refresh);
    return () => {
      active = false;
      off();
    };
  }, [id]);
  return url;
}
