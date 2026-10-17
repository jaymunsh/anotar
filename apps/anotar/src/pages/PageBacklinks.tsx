import { useContext, useEffect, useState } from 'react';
import { CheckSquare, FileText } from 'lucide-react';
import { PageNavContext } from './pageNav';

type Backlinks = {
  items: { id: string; title: string; icon: string }[];
  nextOffset: number | null;
  tasks?: { id: string; title: string; status: 'open' | 'done' }[];
};

/** Pages that link here and tasks that use this page as their reference. Hidden when there are none. */
export default function PageBacklinks({ pageId }: { pageId: string }) {
  const [data, setData] = useState<Backlinks | null>(null);
  const navigate = useContext(PageNavContext);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    void fetch(`/api/pages/${pageId}/backlinks`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: Backlinks | null) => !controller.signal.aborted && setData(value))
      .catch(() => {});
    return () => controller.abort();
  }, [pageId]);
  // ponytail: first 20 pages only; add "더 보기" with nextOffset if a page ever gets more.
  if (!data || (!data.items.length && !data.tasks?.length)) return null;
  const open = (event: React.MouseEvent, path: string) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  };
  return (
    <section className="page-backlinks" aria-label="이 페이지를 참조하는 곳">
      <h2>이 페이지를 참조하는 곳</h2>
      <ul>
        {data.items.map((item) => (
          <li key={item.id}>
            <a href={`/pages/${item.id}`} onClick={(event) => open(event, `/pages/${item.id}`)}>
              {item.icon ? <span aria-hidden>{item.icon}</span> : <FileText size={14} aria-hidden />}
              <span>{item.title || '제목 없음'}</span>
            </a>
          </li>
        ))}
        {data.tasks?.map((task) => (
          <li key={task.id} className={task.status === 'done' ? 'is-done' : undefined}>
            <a href={`/tasks?taskId=${task.id}`} onClick={(event) => open(event, `/tasks?taskId=${task.id}`)}>
              <CheckSquare size={14} aria-hidden />
              <span>{task.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
