import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { StreamChat } from "stream-chat";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Initialize Stream Client
const chatClient = StreamChat.getInstance(
	process.env.STREAM_API_KEY!,
	process.env.STREAM_API_SECRET!
);

// Initialize Gemini Openrouter API key
const openRouterAI = process.env.OPENROUTER_API_KEY;

app.post("/chat", async (req: Request, res: Response): Promise<any> => {
	const { message, userId } = req.body;
	if (!message || !userId) {
		return res.status(400).json({ error: "Message and userId are required" });
	}

	try {
		// Verify user exists in Stream Chat
		const userResponse = await chatClient.queryUsers({ id: userId });
		if (!userResponse.users.length) {
			return res
				.status(404)
				.json({ error: "User not found. Please register first." });
		}
		const response = await fetch(
			"https://openrouter.ai/api/v1/chat/completions",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${openRouterAI}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "google/gemini-2.0-flash-exp:free",
					messages: [{ role: "user", content: message }],
				}),
			}
		);

		const data = await response.json();
		console.log(
			"Response:",
			data?.choices[0]?.message?.content || "No response"
		);

		res.json({ response: data });
	} catch (error) {
		console.error("Error in /chat endpoint:", error);
		return res.status(500).json({
			error: error instanceof Error ? error.message : "Internal server error",
		});
	}
});

// register user with Stream Chat
app.post(
	"/register-user",
	async (req: Request, res: Response): Promise<any> => {
		const { name, email } = req.body;

		if (!name || !email) {
			return res.status(400).json({ error: "Name and email are required" });
		}

		try {
			// Create a new user
			const userId = email.replace(/[^a-zA-Z0-9_-]/g, "_"); // Use email as user ID

			// Check if user already exists
			const existingUser = await chatClient.queryUsers({ id: { $eq: userId } });

			if (!existingUser.users.length) {
				// Add new user to Stream Chat
				await chatClient.upsertUser({
					id: userId,
					name: name,
					email: email,
					role: "user",
				});
			}

			res.status(200).json({ userId, name, email });
		} catch (error) {
			return res.status(500).json({ error: "Internal server error" });
		}
	}
);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
