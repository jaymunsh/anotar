import { resolve } from 'node:path';
import { createBackup, restoreBackup, verifyBackup } from '../server/backups.mjs';

const [command, source, destination] = process.argv.slice(2);
try {
  let manifest;
  if (command === 'create' && source && destination)
    manifest = await createBackup(resolve(source), resolve(destination));
  else if (command === 'verify' && source && !destination)
    manifest = await verifyBackup(resolve(source));
  else if (command === 'restore' && source && destination)
    manifest = await restoreBackup(resolve(source), resolve(destination));
  else
    throw new Error(
      '사용법: npm run backup -- create <data-dir> <backup-dir> | verify <backup-dir> | restore <backup-dir> <new-data-dir>',
    );
  console.log(`${command} 완료: ${manifest.files.length}개 첨부, ${manifest.createdAt}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : '백업 작업에 실패했습니다.');
  process.exitCode = 1;
}
