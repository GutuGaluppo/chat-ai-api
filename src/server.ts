import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { StreamChat } from "stream-chat";

import { db } from "./config/database.js";
import { chats, users } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { ChatCompletionMessageParam } from "openai/resources";

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

		// Check user in database
		const existingUser = await db
			.select()
			.from(users)
			.where(eq(users.userId, userId));

		if (!existingUser.length) {
			return res
				.status(404)
				.json({ error: "User not found in database, please register first." });
		}

		// Fetch users past messages for context
		const chatHistory = await db
			.select()
			.from(chats)
			.where(eq(chats.userId, userId))
			.orderBy(chats.createdAt)
			.limit(10);

		// Format chat history for Gemini API
		const conversation: ChatCompletionMessageParam[] = chatHistory.flatMap(
			(chat) => [
				{ role: "user", content: chat.message },
				{ role: "assistant", content: chat.reply },
			]
		);

		// Add latest user messages to the conversation
		conversation.push({ role: "user", content: message });

		const response = await fetch(
			"https://openrouter.ai/api/v1/chat/completions",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${openRouterAI}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "nousresearch/deephermes-3-mistral-24b-preview:free",
					// model: "google/gemini-2.0-flash-exp:free",
					messages: conversation as ChatCompletionMessageParam[],
				}),
			}
		);

		const data = await response.json();
		const aiMessage =
			data?.choices[0]?.message?.content ??
			"Sorry, I'm not sure how to respond to that now. Please try again later.";

		// Save message to database
		await db.insert(chats).values({
			userId,
			message,
			reply: aiMessage,
		});

		// Create or get channel
		const channel = chatClient.channel("messaging", `chat-${userId}`, {
			members: [userId],
			created_by_id: "ai_bot",
		});

		await channel.create();
		await channel.sendMessage({ text: aiMessage, user_id: "ai_bot" });

		res.status(200).json({ reply: aiMessage });
	} catch (error) {
		console.error("Error in /chat endpoint:", error);
		return res.status(500).json({
			error: error instanceof Error ? error.message : "Internal server error",
		});
	}
});

// Get chat history
app.post("/get-messages", async (req: Request, res: Response): Promise<any> => {
	const { userId } = req.query;
	if (!userId) {
		return res.status(400).json({ error: "User ID is required" });
	}
	try {
		// Fetch chat history from database
		const chatHistory = await db
			.select()
			.from(chats)
			.where(eq(chats.userId, userId as string));

		res.status(200).json({ messages: chatHistory });
	} catch (error) {
		console.error("Error in /get-messages endpoint:", error);
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
			const userResponse = await chatClient.queryUsers({ id: { $eq: userId } });

			if (!userResponse.users.length) {
				// Add new user to Stream Chat
				await chatClient.upsertUser({
					id: userId,
					name: name,
					role: "user",
					...email,
				});
			}
			// Check if user already exists in the database
			const existingUser = await db
				.select()
				.from(users)
				.where(eq(users.userId, userId));

			if (!existingUser.length) {
				console.log(
					`User ${userId} does not exist in the database. Adding them...`
				);
				await db.insert(users).values({
					userId,
					name,
					email,
				});
			}

			console.log("User registered successfully", name, email);
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
