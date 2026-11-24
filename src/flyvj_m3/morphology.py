"""Offline public demo morphology, pinned bytes and unregistered coordinates.

The manifest digest is a reviewed local trust anchor, not a claim of anatomical
registration. Updating source bytes requires explicit review and a new pin.
"""
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import stat

ASSET_DIRECTORY = Path('data/morphology-candidate-20261004')
MANIFEST_SHA256 = 'c0dc6e4a3b1ab4793ed5737d01252886891a93bf29a987c73dfe1e04ad8f857e'
MAX_MANIFEST_BYTES = 64 * 1024
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 4 * 1024 * 1024
MAX_NUMBERS = 300000
MAX_NODES = 50000
REGION_IDS = frozenset(('AL_L_','AL_R_','MB_L_','MB_R_','EB','FB','PB',
                        'LAL_L_','LAL_R_','GNG','LO_R_','LOP_R_','ME_R_','LH_R_'))
EXPECTED_PATHS = frozenset({'hemibrain_neuron.swc','sources/neu3d-README.md',
                           'sources/ffbo.lib-README.md','sources/ffbo.lib-LICENSE.md'} |
                          {f'meshes/{name}.json' for name in REGION_IDS})


def _read_contained(root, relative, limit):
    """Bounded local read; reject traversal, ADS, symlinks and Windows junctions."""
    if (not isinstance(relative,str) or not relative or '\\' in relative or ':' in relative
            or relative.startswith('/') or any(p in ('','.', '..') for p in relative.split('/'))):
        raise ValueError('Invalid morphology relative path')
    if type(limit) is not int or limit < 0 or limit > MAX_TOTAL_BYTES:
        raise ValueError('Invalid morphology byte limit')
    root = Path(root).resolve(strict=True)
    target = root
    for part in PurePosixPath(relative).parts:
        target = target / part
        info = target.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0) & 0x400:
            raise ValueError('Morphology reparse/symlink path refused')
    if not target.resolve(strict=True).is_relative_to(root):
        raise ValueError('Morphology path escapes project')
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise ValueError('Morphology file not regular or exceeds byte limit')
    with target.open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('Morphology file exceeds byte limit')
    return raw


def _json(raw):
    def pairs(items):
        result = {}
        for key,value in items:
            if key in result:
                raise ValueError('Duplicate morphology JSON key')
            result[key] = value
        return result
    def nonfinite(value):
        raise ValueError('Nonfinite morphology JSON value')
    try:
        return json.loads(raw,object_pairs_hook=pairs,parse_constant=nonfinite)
    except (UnicodeError,RecursionError) as exc:
        raise ValueError('Invalid morphology JSON') from exc


def _finite(value):
    try:
        return type(value) in (int,float) and math.isfinite(value)
    except OverflowError:
        return False


def parse_region(region_id, raw):
    """Validate raw flat XYZ and zero-based triangle indices without rescaling."""
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError('Morphology region exceeds byte limit')
    source = _json(raw)
    if not isinstance(source,dict):
        raise ValueError('Morphology region must be an object')
    vertices,faces = source.get('vertices'),source.get('faces')
    for values in (vertices,faces):
        if not isinstance(values,list) or not values or len(values)%3 or len(values)>MAX_NUMBERS:
            raise ValueError('Morphology requires bounded XYZ / triangle triples')
    if not all(_finite(value) for value in vertices):
        raise ValueError('Morphology coordinates must be finite numbers')
    if not all(type(index) is int and 0 <= index < len(vertices)//3 for index in faces):
        raise ValueError('Morphology triangle index out of range or not integer')
    if any(len(set(faces[i:i+3])) != 3 for i in range(0,len(faces),3)):
        raise ValueError('Morphology triangle repeats a vertex')
    for i in range(0,len(faces),3):
        a,b,c = [vertices[index*3:index*3+3] for index in faces[i:i+3]]
        u = [b[j]-a[j] for j in range(3)]
        v = [c[j]-a[j] for j in range(3)]
        cross = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
        if not all(_finite(n) for n in cross) or not any(cross):
            raise ValueError('Morphology degenerate/nonfinite triangle')
    return {'id':region_id,'vertices':vertices,'faces':faces}


def parse_swc(raw):
    """Validate a single rooted SWC tree in linear time, preserving sample order."""
    if len(raw)>MAX_FILE_BYTES:
        raise ValueError('Morphology SWC exceeds byte limit')
    samples=[];parents={}
    try:
        lines=raw.decode('utf-8').splitlines()
        for line in lines:
            line=line.strip()
            if not line or line.startswith('#'):
                continue
            fields=line.split()
            if len(fields)!=7 or any(re.fullmatch(r'-?\d+',fields[i]) is None for i in (0,1,6)):
                raise ValueError('Malformed SWC record')
            sample_id,kind,parent=int(fields[0]),int(fields[1]),int(fields[6])
            coords=[float(value) for value in fields[2:6]]
            if (sample_id<=0 or sample_id in parents or kind<0 or
                    not all(math.isfinite(v) for v in coords) or coords[3]<0 or
                    (parent != -1 and parent<=0)):
                raise ValueError('Invalid SWC id, duplicate, coordinates or radius')
            parents[sample_id]=parent
            samples.append([sample_id,*coords,parent])
            if len(samples)>MAX_NODES:
                raise ValueError('SWC node count exceeds limit')
    except UnicodeError as exc:
        raise ValueError('Invalid SWC encoding') from exc
    roots=[node for node,parent in parents.items() if parent==-1]
    if len(roots)!=1:
        raise ValueError('SWC must have exactly one root')
    if any(parent!=-1 and parent not in parents for parent in parents.values()):
        raise ValueError('SWC missing parent')
    complete={roots[0]}
    for start in parents:
        current=start;chain=set()
        while current not in complete:
            if current in chain:
                raise ValueError('SWC cycle')
            chain.add(current);current=parents[current]
        complete.update(chain)
    return {'samples':samples,'node_count':len(samples),'edge_count':len(samples)-1}


def load_morphology(project_root):
    """Load only the 18 pinned local assets; no network, proxies or work imports."""
    root=Path(project_root).resolve(strict=True)
    prefix=ASSET_DIRECTORY.as_posix()+'/'
    manifest_raw=_read_contained(root,prefix+'source_manifest.json',MAX_MANIFEST_BYTES)
    if hashlib.sha256(manifest_raw).hexdigest()!=MANIFEST_SHA256:
        raise ValueError('Morphology manifest digest does not match trusted pin')
    manifest=_json(manifest_raw)
    records=manifest.get('records')
    if (not isinstance(records,list) or len(records)!=18 or
            {r.get('path') for r in records}!=EXPECTED_PATHS):
        raise ValueError('Morphology manifest asset inventory mismatch')
    regions=[];neuron=None;hashes={};total=0
    for record in records:
        name=record['path'];size=record['bytes']
        if type(size) is not int or not 0<size<=MAX_FILE_BYTES:
            raise ValueError('Morphology source size exceeds limit')
        total+=size
        if total>MAX_TOTAL_BYTES:
            raise ValueError('Morphology total exceeds byte limit')
        raw=_read_contained(root,prefix+name,size)
        digest=hashlib.sha256(raw).hexdigest()
        if len(raw)!=size or digest!=record['sha256']:
            raise ValueError('Morphology asset size/hash mismatch: '+name)
        hashes[name]=digest
        if name.startswith('meshes/'):
            regions.append(parse_region(PurePosixPath(name).stem,raw))
        elif name=='hemibrain_neuron.swc':
            neuron=parse_swc(raw)
    if total!=manifest['total_stored_bytes'] or len(regions)!=14 or neuron is None:
        raise ValueError('Morphology source inventory incomplete')
    if neuron['node_count']!=36044 or neuron['edge_count']!=36043:
        raise ValueError('Morphology SWC sample count mismatch')
    return {'schema_version':1,'semantics':'PUBLIC_MORPHOLOGY_DEMO_UNREGISTERED',
            'registration':'UNVERIFIED_NO_OVERLAY','units':'UNCONFIRMED','body_id':None,
            'regions':regions,'neuron':neuron,'source_hashes':hashes}
