import MessageType from "../enums/message-type.js";

interface Message {
	id: string;
	type: MessageType;
	content: string;

	name: string;
	date: string;
}

export default Message;
