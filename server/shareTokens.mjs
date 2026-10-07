import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const shareLinkKeyFile = 'share-link.key';

// Separate from SQLite: the public reader only needs token hashes, never this key.
export function createShareTokenVault(dataDir, hasStoredTokens) {
  const path=join(dataDir,shareLinkKeyFile);
  function key(create=false) {
    try {
      const info=lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size!==32) throw Error('Invalid key');
      const value=readFileSync(path);
      if (value.length!==32) throw Error('Invalid key');
      return value;
    } catch (error) {
      if (error.code!=='ENOENT' || !create || hasStoredTokens()) throw Error('공유 링크 키를 확인해 주세요. 기존 키를 복원해야 해요.');
      const temp=path+'.'+randomUUID();
      writeFileSync(temp,randomBytes(32),{mode:0o600,flag:'wx'});
      try {try {linkSync(temp,path);} catch (cause) {if(cause.code!=='EEXIST')throw cause;}}
      finally {unlinkSync(temp);}
      return key();
    }
  }
  return {
    encrypt(token, context) {
      const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key(true),iv);
      cipher.setAAD(Buffer.from('leneu:share-link:v1:'+context));
      const value=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
      return [iv,cipher.getAuthTag(),value].map(part=>part.toString('base64url')).join('.');
    },
    decrypt(value, context) {
      try {
        const [iv,tag,encrypted]=value.split('.').map(part=>Buffer.from(part,'base64url'));
        const cipher=createDecipheriv('aes-256-gcm',key(),iv);
        cipher.setAAD(Buffer.from('leneu:share-link:v1:'+context)); cipher.setAuthTag(tag);
        return Buffer.concat([cipher.update(encrypted),cipher.final()]).toString('utf8');
      } catch {throw Error('공유 링크를 읽지 못했어요. 백업의 공유 링크 키를 확인해 주세요.');}
    },
  };
}
