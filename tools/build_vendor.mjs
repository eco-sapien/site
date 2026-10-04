import { build } from 'esbuild';
import {readFile,readdir,writeFile} from 'node:fs/promises';
const result = await build({
  entryPoints: ['tools/vendor_entry.js'],
  outfile: 'assets/vendor/supabase.js',
  bundle: true, minify: true, format: 'iife', platform: 'browser',
  globalName: 'EcoCloudSDK', target: ['es2022'], legalComments: 'linked', metafile: true,
  banner: { js: '/* Supabase JS 2.117.2 and tus-js-client 4.3.1. See LICENSES.txt. Built with npm run build:vendor. */' }
});
const packages = new Set(Object.keys(result.metafile.inputs).map(path => path.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean));
const notices = [];
for (const name of [...packages].sort()) {
  const root = 'node_modules/'+name+'/', pkg = JSON.parse(await readFile(root+'package.json','utf8'));
  const files = (await readdir(root)).filter(file=>/^licen[sc]e(?:\.(?:txt|md))?$/i.test(file));
  if (!files.length) throw new Error('Missing licence text for bundled package '+name);
  notices.push(name+' '+pkg.version+'\n'+'='.repeat(64)+'\n'+await readFile(root+files[0],'utf8'));
}
await writeFile('assets/vendor/LICENSES.txt',notices.join('\n\n'));
