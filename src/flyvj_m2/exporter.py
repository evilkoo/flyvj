"""Verified local sample -> self-contained HTML. No fetching or live input."""
import json
from pathlib import Path

from flyvj_m0.dataset import load_dataset
from flyvj_m0.pipeline import MockEvent, run_mock_pipeline
from flyvj_m0.provenance import verify_curated_dataset

UI_DIR = Path(__file__).resolve().parent / 'ui'


def build_payload(dataset_path):
    dataset = load_dataset(dataset_path)
    if dataset.provenance.kind != 'real':
        raise ValueError('M2 requires the pinned real M1 sample, not synthetic')
    proof = verify_curated_dataset(dataset)
    if proof.get('verified') is not True:
        raise ValueError('M1 source gate did not verify the selected dataset')
    energies = (0, .399999, .4, .749999, .75, 1)
    events = [MockEvent(f'm2-rule-{i}', i, i*1000, energy) for i,energy in enumerate(energies)]
    result = run_mock_pipeline(events)
    rules = [dict(energy=e.energy, column=d['column'], reason=d['reason'])
             for e,d in zip(events,result['decisions'])]
    return dict(schema_version=1, scope='M2_OFFLINE_POINT_GRAPH', dataset=dataset.to_payload(),
                dataset_fingerprint=dataset.fingerprint, source_check=proof,
                render_order=list(reversed(dataset.neuron_ids)), rule_examples=rules)


def script_json(payload):
    text = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    for char,escaped in (('<',r'\u003c'),('>',r'\u003e'),('&',r'\u0026'),('\u2028',r'\u2028'),('\u2029',r'\u2029')):
        text=text.replace(char,escaped)
    return text


def render_console(payload, assets_dir=UI_DIR):
    assets_dir = Path(assets_dir)
    template = (assets_dir / 'index.html').read_text(encoding='utf-8-sig')
    replacements = {'__M2_STYLE__': (assets_dir/'style.css').read_text(encoding='utf-8-sig'),
                    '__M2_PAYLOAD__': script_json(payload),
                    '__M2_CORE__': (assets_dir/'core.js').read_text(encoding='utf-8-sig'),
                    '__M2_APP__': (assets_dir/'app.js').read_text(encoding='utf-8-sig')}
    for marker in replacements:
        if template.count(marker) != 1:
            raise ValueError(f'Template requires exactly one {marker}')
    # One pass over ORIGINAL template, never replace within embedded data or code.
    import re
    return re.sub('|'.join(re.escape(m) for m in replacements),lambda m:replacements[m.group()],template)


def write_console(target, payload):
    content=render_console(payload)
    with Path(target).open('x', encoding='utf-8', newline='\n') as handle:
        handle.write(content)
    return Path(target)
