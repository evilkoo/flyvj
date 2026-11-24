"""M3 self-contained audio console, strict M1/M2 local source gate."""
from pathlib import Path
import re
from flyvj_m2.exporter import build_payload as build_m2_payload, script_json
from .morphology import load_morphology
UI_DIR=Path(__file__).resolve().parent/'ui'
GEOMETRY=Path(__file__).resolve().parents[1]/'flyvj_m2/ui/core.js'

def build_payload(dataset_path, project_root=None):
    p=build_m2_payload(dataset_path)
    if p.get('source_check',{}).get('verified') is not True:
        raise ValueError('M3 source gate did not verify the pinned sample')
    root = Path(project_root) if project_root is not None else Path(__file__).resolve().parents[2]
    p['morphology'] = load_morphology(root)
    p['scope']='M3_LOCAL_FILE_AUDIO'
    p['audio_policy']={'input':'USER_SELECTED_LOCAL_FILE','muted_default':True,'network':False,
                       'microphone':True,'additional_input':'USER_ARMED_AZURE_KINECT_MIC','kinect_microphone_enabled':True,'network_upload':False,
                       'local_features_bridge':True,'auto_capture':False,'osc_sender':False,'max_bytes':64*1024*1024,
                       'max_duration_seconds':900,'fixture_is_synthetic_test_pcm':True}
    p['mapping_semantics']='HUMAN_LOW_MID_HIGH_MAPPING_NOT_BIOLOGICAL_FIRING'
    p['visual_policy']={'stage':'M3C','semantics':'PUBLIC_MORPHOLOGY_DEMO_UNREGISTERED',
                        'default_view':'regions','legacy_semantics':'PROCEDURAL_ILLUSTRATION_NOT_CONNECTOME',
                        'anatomical_registration':False,'separate_views':True,'real_sample_layer_independent':True,
                        'audio_clock_only':True,'network_assets':False}
    return p

def render_console(payload,assets_dir=UI_DIR):
    assets=Path(assets_dir)
    template=(assets/'index.html').read_text(encoding='utf-8-sig')
    replacements={'__M3_STYLE__':(assets/'style.css').read_text(encoding='utf-8-sig'),
                  '__M3_PAYLOAD__':script_json(payload),
                  '__M3_GEOMETRY__':GEOMETRY.read_text(encoding='utf-8-sig'),
                  '__M3_AUDIO__':(assets/'audio.js').read_text(encoding='utf-8-sig'),
                  '__M3_BRAIN_GEOMETRY__':(assets/'brain-geometry.js').read_text(encoding='utf-8-sig'),
                  '__M3_BRAIN_RENDERER__':(assets/'brain-renderer.js').read_text(encoding='utf-8-sig'),
                  '__M3_MIC_BRIDGE__':(assets/'mic-bridge.js').read_text(encoding='utf-8-sig'),
                  '__M3_MORPH_GEOMETRY__':(assets/'public-morphology.js').read_text(encoding='utf-8-sig'),
                  '__M3_MORPH_RENDERER__':(assets/'public-morphology-renderer.js').read_text(encoding='utf-8-sig'),
                  '__M3_APP__':(assets/'app.js').read_text(encoding='utf-8-sig')}
    for marker in replacements:
        if template.count(marker)!=1:raise ValueError('Template must contain exactly one '+marker)
    return re.sub('|'.join(re.escape(m) for m in replacements),lambda m:replacements[m.group()],template)

def write_console(target,payload):
    html=render_console(payload)
    with Path(target).open('x',encoding='utf-8',newline='\n') as file:file.write(html)
    return Path(target)
