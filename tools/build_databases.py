#!/usr/bin/env python3
"""Build the combined public programme index and private Databases page."""
import csv
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TYPES = [('cv','CV'),('statement','Statement / essay'),('portfolio','Portfolio / proposal'),('degree','Degree certificate'),('transcript','Transcript'),('language','English evidence'),('aps','APS / qualification check'),('reference','Reference'),('employment','Work evidence')]

def combined_data():
    masters = json.loads((ROOT/'data/all-applications.json').read_text())['records']
    art = list(csv.DictReader((ROOT/'programmes.csv').open(encoding='utf-8-sig')))
    mapping = json.loads((ROOT/'data/art-application-map.json').read_text())
    assert len(art) == len(mapping) == 24
    records = {}
    for r in masters:
        records[r['id']] = {**r, 'collections':['masters'], 'country':'Germany', 'catalogue_url':'all-applications.html#route-'+r['id'], 'art_url':''}
    for maprow, r in zip(mapping, art):
        number = maprow['number']
        assert number == mapping.index(maprow)+1
        key = maprow['id']
        art_url = 'applications.html#programme-'+str(number)
        if key in records:
            records[key]['collections'].append('art')
            records[key]['art_url'] = art_url
            records[key]['art_requirements'] = r['Portfolio requirements']
            continue
        sources = r['Official programme / admission sources'].split(' | ')
        records[key] = {
            'id':key, 'programme':r['Programme'], 'university':r['University'], 'city':r['Location'],
            'country':r['Location'].split(', ')[-1], 'collections':['art'], 'field':'Art & design',
            'assessment':r['Priority'], 'fit':r['Degree eligibility for your background'],
            'requirements':r['Portfolio requirements'], 'art_requirements':r['Portfolio requirements'],
            'deadline':maprow.get('deadline'), 'deadline_time':maprow.get('deadline_time',''),
            'date_basis':'Published 2027 dates in research snapshot' if maprow.get('deadline') else 'Next-cycle exact date unverified',
            'window':r['Next application window'], 'intake':'2027 · confirm intake',
            'programme_url':sources[0], 'application_url':sources[0], 'portal_url':sources[0],
            'catalogue_url':art_url, 'art_url':art_url, 'checked_at':r['Checked on'],
            'candidate':r['Priority'] not in ['Language / degree obstacle','Language / fee obstacle','Longer route / language obstacle'],
            'sources':[{'label':'University source','url':url} for url in sources], 'rank':number-1
        }
    records['daad-11191']['deadline_time'] = '16:00 local time'
    result = {'checked_at':'2026-10-04','art_checked_at':'2026-10-01','master_count':len(masters),'art_count':len(art),'overlap_count':len(masters)+len(art)-len(records),'records':list(records.values())}
    assert len(result['records']) == 149
    return result

def build():
    data = combined_data()
    (ROOT/'data/databases.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    template = (ROOT/'tools/templates/databases.html').read_text()
    shelf = ''.join(f'<article class="resource-card" data-resource="{key}"><h3>{html.escape(label)}</h3><p data-resource-state>No file attached</p><div class="resource-actions"><button class="button upload-button" data-library-upload="{key}" type="button">Upload ↑</button><button class="button" data-library-download="{key}" type="button" disabled>Download ↓</button><button class="text-button" data-library-versions="{key}" type="button">Versions</button><a data-library-open="{key}" target="_blank" rel="noopener noreferrer" hidden>Open existing Drive file ↗</a></div><details class="manual-link"><summary>Keep an existing Drive link</summary><label for="library-{key}">Existing Drive link<input id="library-{key}" type="url" data-library-document="{key}" maxlength="2048" autocomplete="off" placeholder="https://drive.google.com/…"></label></details></article>' for key,label in TYPES)
    encoded = json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('&','\\u0026')
    result = template.replace('@@COUNT@@',str(len(data['records']))).replace('@@LIBRARY@@',shelf).replace('@@DATA@@',encoded)
    assert '@@' not in result
    (ROOT/'databases.html').write_text(result)
    # Add stable links from the existing, hand-maintained art comparison.
    art = (ROOT/'applications.html').read_text()
    art = re.sub(r'<a class="button database-link"[^>]*>Track in Databases →</a>', '', art)
    for item in json.loads((ROOT/'data/art-application-map.json').read_text()):
        pattern = rf'(<article\b[^>]*\bid="programme-{item["number"]}".*?)(</article>)'
        art, count = re.subn(pattern, lambda match: match[1]+f'<a class="button database-link" href="databases.html#application-{item["id"]}">Track in Databases →</a>'+match[2], art, count=1, flags=re.S)
        assert count == 1,item
    (ROOT/'applications.html').write_text(art)
    print(f'Built Databases with {len(data["records"])} unique programmes ({data["overlap_count"]} shared entries combined).')

if __name__ == '__main__':
    build()
