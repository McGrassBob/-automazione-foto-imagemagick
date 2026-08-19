const express = require("express");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const app = express();
const upload = multer({ dest: os.tmpdir() });

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "automazione-foto-imagemagick",
    message: "ImageMagick service online"
  });
});

app.post("/develop", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Immagine mancante" });
  }

  const inputPath = req.file.path;
  const outputPath = path.join(os.tmpdir(), `output-${Date.now()}.jpg`);

  const brightness = Number(req.body.brightness ?? 100);
  const saturation = Number(req.body.saturation ?? 100);
  const contrast = Number(req.body.contrast ?? 0);
  const gamma = Number(req.body.gamma ?? 1);
  const temperature = Number(req.body.temperature ?? 0);
  const tint = Number(req.body.tint ?? 0);
  const sharpen = Number(req.body.sharpen ?? 0.4);
  const quality = Number(req.body.quality ?? 95);

  const args = [
    inputPath,
    "-colorspace", "sRGB",

    // luminosità + saturazione
    "-modulate",
    `${brightness},${saturation},100`,

    // gamma
    "-gamma",
    String(gamma),
  ];

  // contrasto leggero
  if (contrast !== 0) {
    const slope = Math.max(0.8, Math.min(1.25, 1 + contrast / 100));
    const intercept = (1 - slope) / 2;
    args.push(
      "-evaluate", "Multiply", String(slope),
      "-evaluate", "Add", String(intercept)
    );
  }

  // temperatura:
  // negativo = più fredda / meno gialla
  // positivo = più calda
  if (temperature !== 0) {
    const amount = Math.max(-100, Math.min(100, temperature));

    if (amount < 0) {
      const cool = Math.abs(amount) / 100;

      args.push(
        "-channel", "R",
        "-evaluate", "Multiply", String(1 - cool * 0.10),
        "-channel", "B",
        "-evaluate", "Multiply", String(1 + cool * 0.14),
        "+channel"
      );
    } else {
      const warm = amount / 100;

      args.push(
        "-channel", "R",
        "-evaluate", "Multiply", String(1 + warm * 0.12),
        "-channel", "B",
        "-evaluate", "Multiply", String(1 - warm * 0.10),
        "+channel"
      );
    }
  }

  // tint:
  // negativo = verso verde
  // positivo = verso magenta
  if (tint !== 0) {
    const amount = Math.max(-100, Math.min(100, tint));

    if (amount > 0) {
      const magenta = amount / 100;

      args.push(
        "-channel", "G",
        "-evaluate", "Multiply", String(1 - magenta * 0.10),
        "+channel"
      );
    } else {
      const green = Math.abs(amount) / 100;

      args.push(
        "-channel", "G",
        "-evaluate", "Multiply", String(1 + green * 0.10),
        "+channel"
      );
    }
  }

  if (sharpen > 0) {
    args.push("-unsharp", `0x${sharpen}+0.7+0.02`);
  }

  args.push(
    "-strip",
    "-quality", String(quality),
    outputPath
  );

  execFile("convert", args, (error, stdout, stderr) => {
    if (error) {
      console.error(stderr);

      try { fs.unlinkSync(inputPath); } catch {}

      return res.status(500).json({
        error: "Errore ImageMagick",
        detail: stderr
      });
    }

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", 'inline; filename="developed.jpg"');

    const stream = fs.createReadStream(outputPath);

    stream.pipe(res);

    stream.on("close", () => {
      try { fs.unlinkSync(inputPath); } catch {}
      try { fs.unlinkSync(outputPath); } catch {}
    });
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ImageMagick service listening on port ${PORT}`);
});
