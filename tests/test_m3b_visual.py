import unittest
from pathlib import Path
from flyvj_m3.exporter import build_payload, render_console
ROOT=Path(__file__).resolve().parents[1]
class M3BVisualExportTests(unittest.TestCase):
    def test_export_embeds_procedural_assets_and_truth_policy(self):
        p=build_payload(ROOT/'data/flywire783-m1/sample.json')
        self.assertEqual(p['visual_policy']['semantics'],'PROCEDURAL_ILLUSTRATION_NOT_CONNECTOME')
        self.assertFalse(p['visual_policy']['anatomical_registration'])
        html=render_console(p)
        self.assertIn('FlyVJBrainGeometry',html); self.assertIn('FlyVJBrainRenderer',html)
        self.assertIn('M3B',html); self.assertIn('model-semantics',html)
        for marker in ('__M3_BRAIN_GEOMETRY__','__M3_BRAIN_RENDERER__'):self.assertNotIn(marker,html)
        self.assertIn("connect-src 'self'",html)
        self.assertNotIn('getUserMedia(',html);self.assertNotIn('getDisplayMedia(',html)
    def test_real_sample_and_dsp_stay_separate(self):
        p=build_payload(ROOT/'data/flywire783-m1/sample.json')
        self.assertEqual(len(p['dataset']['neurons']),6);self.assertEqual(len(p['dataset']['connections']),3)
        self.assertEqual(p['mapping_semantics'],'HUMAN_LOW_MID_HIGH_MAPPING_NOT_BIOLOGICAL_FIRING')
        self.assertFalse(p['audio_policy']['osc_sender']);self.assertFalse(p['audio_policy']['network'])

    def test_native_mic_policy_and_safe_inline_bridge(self):
        p=build_payload(ROOT/'data/flywire783-m1/sample.json')
        self.assertTrue(p['audio_policy']['microphone'])
        self.assertEqual(p['audio_policy']['additional_input'],'USER_ARMED_AZURE_KINECT_MIC')
        self.assertTrue(p['audio_policy']['kinect_microphone_enabled'])
        self.assertFalse(p['audio_policy']['network_upload'])
        self.assertTrue(p['audio_policy']['local_features_bridge'])
        self.assertFalse(p['audio_policy']['auto_capture'])
        html=render_console(p)
        self.assertIn('FlyVJKinectBridge',html)
        self.assertIn('開始 Kinect Mic',html)
        self.assertNotIn('__M3_MIC_BRIDGE__',html)
        self.assertNotIn('getUserMedia',html)
        self.assertNotIn('session',str(p['audio_policy']))
