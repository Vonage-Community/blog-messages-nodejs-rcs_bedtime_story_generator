import Express from "express";
import debug from "debug";
import { RCSCustom, RCSText } from "@vonage/messages";
import { vonage } from "./vonage.js";
import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { verifySignature } from "@vonage/jwt";

const log = debug("bedtime-story:server");

const app = new Express();
const port = process.env.PORT || 3000;
const recipientNumber = process.env.PHONE_NUMBER;

if (!recipientNumber || !process.env.RCS_SENDER_ID || !process.env.GEMINI_API_KEY || !process.env.VONAGE_API_SIGNATURE_SECRET) {
  console.error("Missing required environment variable(s).");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const catchAsync = (fn) => (req, res, next) => {
  fn(req, res, next).catch(next);
};

app.use(Express.json());

const verifyWebhookSignature = (req, res, next) => {
  try {
    const jwtToken = req.headers.authorization.split(" ")[1];
    if (!jwtToken) {
      return res.status(401).json({
        status: 401,
        title: "Unauthorized",
        detail: "No JWT token provided.",
      });
    }

    const isValid = verifySignature(jwtToken, process.env.VONAGE_API_SIGNATURE_SECRET);

    if (!isValid) {
      return res.status(401).json({
        status: 401,
        title: "Unauthorized",
        detail: "Invalid JWT signature.",
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      status: 401,
      title: "Unauthorized",
      detail: "JWT verification failed.",
    });
  }
};

app.get(
  "/send-story-request",
  catchAsync(async (req, res) => {
    await sendInitialStoryPrompt(recipientNumber);
    res.status(200).json({ message: "Bedtime story prompt sent!" });
  })
);

app.post(
  "/webhooks/status",
  verifyWebhookSignature,
  catchAsync(async (req, res) => {
    res.status(200).json({ ok: true });
  })
);

app.post(
  "/webhooks/inbound",
  verifyWebhookSignature,
  catchAsync(async (req, res) => {
    const { channel, message_type, reply, from } = req.body;

    if (channel === "rcs" && message_type === "reply" && reply) {
      const receivedId = reply.id;
      const receivedTitle = reply.title;

      if (receivedId === "GENERATE_STORY_REQUEST" || receivedTitle === "Generate Story") {
        const replyToNumber = from;

        try {
          const prompt = "Generate a short, calming bedtime story for children (approx. 100-150 words).";
          const result = await geminiModel.generateContent(prompt);
          const response = await result.response;
          const story = response.text();
          await sendGeneratedStory(replyToNumber, story);
        } catch (geminiError) {
          await sendGeneratedStory(
            replyToNumber,
            "Oops! I couldn't generate a story right now. Please try again later."
          );
        }
      } else {
        // unhandled reply
      }
    } else if (channel === "rcs" && message_type === "text") {
      if (req.body.text && req.body.text.toLowerCase() === "generate story") {
        try {
          const prompt = "Generate a short, calming bedtime story for children (approx. 100-150 words).";
          const result = await geminiModel.generateContent(prompt);
          const response = await result.response;
          const story = response.text();
          await sendGeneratedStory(from, story);
        } catch (geminiError) {
          await sendGeneratedStory(
            from,
            "Oops! I couldn't generate a story right now. Please try again later."
          );
        }
      } else {
        await sendGeneratedStory(
          from,
          "I received your message: " +
            req.body.text +
            ". Tap 'Generate Story' for a tale!"
        );
      }
    }

    res.status(200).json({ ok: true });
  })
);

app.all("*", (req, res) => {
  res.status(404).json({
    status: 404,
    title: "Not Found",
  });
});

app.use((err, req, res, next) => {
  res.status(500).json({
    status: 500,
    title: "Internal Server Error",
    detail: err.message,
  });
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
  console.log(`Access http://localhost:${port}/send-story-request to send the initial prompt.`);
});

const sendInitialStoryPrompt = async (number) => {
  const message = new RCSCustom({
    to: number,
    from: process.env.RCS_SENDER_ID,
    custom: {
      contentMessage: {
        richCard: {
          standaloneCard: {
            cardOrientation: "VERTICAL",
            cardContent: {
              title: "Bedtime Story Generator",
              description: 'Tap "Generate Story" for a magical tale!',
              media: {
                height: "MEDIUM",
                contentInfo: {
                  fileUrl: "https://cdn-icons-png.flaticon.com/512/2917/2917637.png",
                },
              },
              suggestions: [
                {
                  reply: {
                    text: "Generate Story",
                    postbackData: "GENERATE_STORY_REQUEST",
                  },
                },
              ],
            },
          },
        },
      },
    },
  });

  try {
    await vonage.messages.send(message);
  } catch (err) {
    if (err.response) {
      err.response.text().then((text) => {
        console.error("Vonage API Error:", text);
      }).catch(() => {});
    } else {
      console.error("Error sending initial prompt message");
    }
  }
};

const sendGeneratedStory = async (to, story) => {
  const message = new RCSText({
    to: to,
    from: process.env.RCS_SENDER_ID,
    text: story,
  });

  try {
    await vonage.messages.send(message);
  } catch (err) {
    if (err.response) {
      err.response.text().then((text) => {
        console.error("Vonage API Error Response Text for story:", text);
      }).catch(() => {});
    } else {
      console.error("Error sending generated story message");
    }
  }
};
