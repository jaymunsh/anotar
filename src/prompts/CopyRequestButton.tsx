import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyRequestButton({
  text,
  onError,
}: {
  text: string;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      onError('요청문을 복사하지 못했어요. 아래 내용을 직접 선택해 복사해 주세요.');
    }
  }

  return (
    <button
      type="button"
      className="prompt-button quiet"
      onClick={() => void copy()}
      disabled={!text.trim()}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {copied ? '복사됨' : '요청 복사'}
    </button>
  );
}
