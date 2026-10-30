"""Builds public/models/isnet_fp16.onnx from rembg's isnet-general-use.onnx.

The source model exposes every side output; we keep only `output_image` so that
keep_io_types does not leave fp32 tensors feeding fp16 Conv nodes.

    pip install onnx onnxconverter-common
    curl -LO https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx
    python scripts/convert_isnet.py isnet-general-use.onnx isnet_fp16.onnx
"""

import sys

import onnx
from onnxconverter_common import float16

src, dst = sys.argv[1], sys.argv[2]
model = onnx.load(src)
keep = [o for o in model.graph.output if o.name == "output_image"]
del model.graph.output[:]
model.graph.output.extend(keep)
onnx.save(float16.convert_float_to_float16(model, keep_io_types=True), dst)
