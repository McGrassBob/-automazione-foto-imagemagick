const express = require("express");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const app = express();
const upload = multer({ dest: os.tmpdir() });

const PORT = process.env.PORT || 3000;

// Stato temporaneo dei lavori
const jobs = new Map();


// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "automazione-foto-imagemagick",
    message: "ImageMagick service online",
    async: true
  });
});


// ============================================================
// FUNZIONE IMAGEMAGICK
// ============================================================

function developImage(inputPath, outputPath, values) {

  return new Promise((resolve, reject) => {

    const {
      brightness,
      saturation,
      contrast,
      gamma,
      temperature,
      tint,
      sharpen,
      quality
    } = values;

    const args = [
      inputPath,

      "-auto-orient",

      "-colorspace",
      "sRGB",

      "-modulate",
      `${brightness},${saturation},100`,

      "-gamma",
      String(gamma),
    ];


    // --------------------------------------------------------
    // CONTRASTO
    // --------------------------------------------------------

    if (contrast !== 0) {

      const slope =
        Math.max(
          0.8,
          Math.min(
            1.25,
            1 + contrast / 100
          )
        );

      const intercept =
        (1 - slope) / 2;

      args.push(
        "-evaluate",
        "Multiply",
        String(slope),

        "-evaluate",
        "Add",
        String(intercept)
      );
    }


    // --------------------------------------------------------
    // TEMPERATURA
    // --------------------------------------------------------

    if (temperature !== 0) {

      const amount =
        Math.max(
          -100,
          Math.min(
            100,
            temperature
          )
        );


      // più fredda
      if (amount < 0) {

        const cool =
          Math.abs(amount) / 100;

        args.push(
          "-channel",
          "R",

          "-evaluate",
          "Multiply",
          String(
            1 - cool * 0.10
          ),

          "-channel",
          "B",

          "-evaluate",
          "Multiply",
          String(
            1 + cool * 0.14
          ),

          "+channel"
        );

      }

      // più calda
      else {

        const warm =
          amount / 100;

        args.push(
          "-channel",
          "R",

          "-evaluate",
          "Multiply",
          String(
            1 + warm * 0.12
          ),

          "-channel",
          "B",

          "-evaluate",
          "Multiply",
          String(
            1 - warm * 0.10
          ),

          "+channel"
        );
      }
    }


    // --------------------------------------------------------
    // TINT
    // --------------------------------------------------------

    if (tint !== 0) {

      const amount =
        Math.max(
          -100,
          Math.min(
            100,
            tint
          )
        );


      // magenta
      if (amount > 0) {

        const magenta =
          amount / 100;

        args.push(
          "-channel",
          "G",

          "-evaluate",
          "Multiply",
          String(
            1 - magenta * 0.10
          ),

          "+channel"
        );

      }

      // verde
      else {

        const green =
          Math.abs(amount) / 100;

        args.push(
          "-channel",
          "G",

          "-evaluate",
          "Multiply",
          String(
            1 + green * 0.10
          ),

          "+channel"
        );
      }
    }


    // --------------------------------------------------------
    // NITIDEZZA
    // --------------------------------------------------------

    if (sharpen > 0) {

      args.push(
        "-unsharp",
        `0x${sharpen}+0.7+0.02`
      );
    }


    // --------------------------------------------------------
    // OUTPUT JPEG
    // --------------------------------------------------------

    args.push(
      "-quality",
      String(quality),

      outputPath
    );


    execFile(
      "convert",
      args,
      (error, stdout, stderr) => {

        if (error) {
          reject(
            new Error(
              stderr ||
              error.message
            )
          );

          return;
        }

        resolve();
      }
    );
  });
}


// ============================================================
// VECCHIO ENDPOINT SINCRONO
// Lo lasciamo disponibile per test.
// ============================================================

app.post(
  "/develop",
  upload.single("image"),
  async (req, res) => {

    if (!req.file) {
      return res.status(400).json({
        error: "Immagine mancante"
      });
    }

    const inputPath =
      req.file.path;

    const outputPath =
      path.join(
        os.tmpdir(),
        `output-${Date.now()}.jpg`
      );


    const values = {

      brightness:
        Number(
          req.body.brightness ?? 100
        ),

      saturation:
        Number(
          req.body.saturation ?? 100
        ),

      contrast:
        Number(
          req.body.contrast ?? 0
        ),

      gamma:
        Number(
          req.body.gamma ?? 1
        ),

      temperature:
        Number(
          req.body.temperature ?? 0
        ),

      tint:
        Number(
          req.body.tint ?? 0
        ),

      sharpen:
        Number(
          req.body.sharpen ?? 0.4
        ),

      quality:
        Number(
          req.body.quality ?? 95
        )
    };


    try {

      await developImage(
        inputPath,
        outputPath,
        values
      );


      res.setHeader(
        "Content-Type",
        "image/jpeg"
      );

      res.setHeader(
        "Content-Disposition",
        'inline; filename="developed.jpg"'
      );


      const stream =
        fs.createReadStream(
          outputPath
        );


      stream.pipe(res);


      stream.on(
        "close",
        () => {

          try {
            fs.unlinkSync(
              inputPath
            );
          } catch {}

          try {
            fs.unlinkSync(
              outputPath
            );
          } catch {}
        }
      );


    } catch (error) {

      try {
        fs.unlinkSync(
          inputPath
        );
      } catch {}

      try {
        fs.unlinkSync(
          outputPath
        );
      } catch {}


      return res
        .status(500)
        .json({
          error:
            "Errore ImageMagick",

          detail:
            error.message
        });
    }
  }
);


// ============================================================
// NUOVO ENDPOINT ASINCRONO
// Render risponde subito e poi lavora in background.
// ============================================================

app.post(
  "/develop-async",
  upload.single("image"),
  async (req, res) => {

    if (!req.file) {
      return res
        .status(400)
        .json({
          ok: false,
          error: "Immagine mancante"
        });
    }


    if (
      !req.body.dropboxToken ||
      !req.body.destinationPath
    ) {

      try {
        fs.unlinkSync(
          req.file.path
        );
      } catch {}


      return res
        .status(400)
        .json({
          ok: false,
          error:
            "Dropbox token o destinationPath mancante"
        });
    }


    const jobId =
      crypto.randomUUID();


    const inputPath =
      req.file.path;


    const outputPath =
      path.join(
        os.tmpdir(),
        `output-${jobId}.jpg`
      );


    const values = {

      brightness:
        Number(
          req.body.brightness ?? 100
        ),

      saturation:
        Number(
          req.body.saturation ?? 100
        ),

      contrast:
        Number(
          req.body.contrast ?? 0
        ),

      gamma:
        Number(
          req.body.gamma ?? 1
        ),

      temperature:
        Number(
          req.body.temperature ?? 0
        ),

      tint:
        Number(
          req.body.tint ?? 0
        ),

      sharpen:
        Number(
          req.body.sharpen ?? 0.4
        ),

      quality:
        Number(
          req.body.quality ?? 95
        )
    };


    const dropboxToken =
      req.body.dropboxToken;


    const destinationPath =
      req.body.destinationPath;


    jobs.set(
      jobId,
      {
        status: "processing",
        destinationPath,
        startedAt:
          new Date().toISOString()
      }
    );


    // Risposta IMMEDIATA a Cloudflare
    res.status(202).json({
      ok: true,
      jobId,
      status: "processing",
      destinationPath
    });


    // ========================================================
    // DA QUI RENDER CONTINUA DA SOLO
    // ========================================================

    try {

      console.log(
        "JOB",
        jobId,
        "ImageMagick avviato"
      );


      await developImage(
        inputPath,
        outputPath,
        values
      );


      const finalBytes =
        fs.readFileSync(
          outputPath
        );


      if (
        finalBytes.length <
        50000
      ) {

        throw new Error(
          "JPEG finale troppo piccolo"
        );
      }


      console.log(
        "JOB",
        jobId,
        "ImageMagick completato:",
        finalBytes.length,
        "bytes"
      );


      // ======================================================
      // UPLOAD DIRETTO SU DROPBOX
      // ======================================================

      const uploadResponse =
        await fetch(
          "https://content.dropboxapi.com/2/files/upload",
          {
            method: "POST",

            headers: {

              Authorization:
                `Bearer ${dropboxToken}`,

              "Content-Type":
                "application/octet-stream",

              "Dropbox-API-Arg":
                JSON.stringify({

                  path:
                    destinationPath,

                  mode:
                    "overwrite",

                  autorename:
                    false,

                  mute:
                    true,

                  strict_conflict:
                    false
                })
            },

            body:
              finalBytes
          }
        );


      if (!uploadResponse.ok) {

        throw new Error(
          "Upload Dropbox fallito: " +
          await uploadResponse.text()
        );
      }


      jobs.set(
        jobId,
        {
          status:
            "completed",

          destinationPath,

          finalSize:
            finalBytes.length,

          completedAt:
            new Date().toISOString()
        }
      );


      console.log(
        "JOB",
        jobId,
        "COMPLETATO"
      );


    } catch (error) {

      console.error(
        "JOB",
        jobId,
        "ERRORE:",
        error.message
      );


      jobs.set(
        jobId,
        {
          status:
            "error",

          destinationPath,

          error:
            error.message,

          completedAt:
            new Date().toISOString()
        }
      );

    } finally {

      try {
        fs.unlinkSync(
          inputPath
        );
      } catch {}


      try {
        fs.unlinkSync(
          outputPath
        );
      } catch {}
    }
  }
);


// ============================================================
// STATO DI UN JOB
// ============================================================

app.get(
  "/job/:id",
  (req, res) => {

    const job =
      jobs.get(
        req.params.id
      );


    if (!job) {

      return res
        .status(404)
        .json({
          ok: false,
          error:
            "Job non trovato"
        });
    }


    return res.json({
      ok: true,
      jobId:
        req.params.id,
      ...job
    });
  }
);


// ============================================================
// SERVER
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `ImageMagick service listening on port ${PORT}`
    );
  }
);
