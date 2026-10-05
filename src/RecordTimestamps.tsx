import { formatKoreanTime } from './time';
import './recordTimestamps.css';

type Props = { createdAt: string; updatedAt: string; className?: string };

export default function RecordTimestamps({ createdAt, updatedAt, className = '' }: Props) {
  return (
    <dl className={`record-timestamps ${className}`} aria-label="기록 일시">
      <div>
        <dt>생성일</dt>
        <dd>
          <time dateTime={createdAt}>{formatKoreanTime(createdAt)}</time>
        </dd>
      </div>
      <div>
        <dt>최종 수정일</dt>
        <dd>
          <time dateTime={updatedAt}>{formatKoreanTime(updatedAt)}</time>
        </dd>
      </div>
    </dl>
  );
}
