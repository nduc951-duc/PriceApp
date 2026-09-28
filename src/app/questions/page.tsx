import { AuthGate } from "@/components/auth-gate";
import { PriceQuestionAssistant } from "@/components/price-question-assistant";
export default function QuestionsPage(){return <AuthGate><PriceQuestionAssistant/></AuthGate>;}
