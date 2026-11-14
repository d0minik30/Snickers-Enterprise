"""Small metadata fixtures (no images): real Perseverance values from the public raw-image feed."""

# Navcam left, sol 47 (NLF_0047_0671121153_414ECM_N0031708NCAM00405_01_295J): model for 1280 x 960.
NAVCAM_MODEL = (
    '(0.992343,0.726242,-1.97352);'
    '(-0.182344,0.982863,0.0273079);'
    '(-845.515,502.591,15.2823);'
    '(-87.0624,456.719,752.465);'
    '(-0.183743,0.982599,0.0274237);'
    '(2e-06,0.049535,-0.015973);'
    '(-0.003612,0.013016,-0.023961);'
    '2.0;'
    '0.0'
)


def navcam_record(attitude=(0.000856471, 0.00401215, 0.020163, 0.999788), xyz='(9.54622,38.3196,0.965741)') -> dict:
    """A raw-image record as the feed returns it, with the fields the answer lives in (attitude, xyz)."""
    return {
        'imageid': 'NLF_0047_0671121153_414ECM_N0031708NCAM00405_01_295J',
        'attitude': '(' + ','.join(f'{x:.9f}' for x in attitude) + ')',
        'date_taken_utc': '2021-04-08T02:34:41.015',
        'extended': {'subframeRect': '(1,1,5120,3840)', 'dimension': '(1280,960)', 'xyz': xyz,
                     'mastAz': '99.8067', 'mastEl': '-1.117', 'scaleFactor': '4'},
        'camera': {'camera_model_component_list': NAVCAM_MODEL, 'camera_model_type': 'CAHVORE',
                   'instrument': 'NAVCAM_LEFT'},
    }
