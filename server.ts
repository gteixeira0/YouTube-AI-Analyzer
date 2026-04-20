import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

// Workaround para plataformas gratuitas (Render, Koyeb) que não suportam upload de arquivos.
// Salva o conteúdo do JSON da Service Account num arquivo temporário e aponta o Google Auth para ele.
if (process.env.GOOGLE_CREDENTIALS_JSON) {
  try {
    const keyPath = path.join(process.cwd(), 'gcp-service-account.json');
    fs.writeFileSync(keyPath, process.env.GOOGLE_CREDENTIALS_JSON);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
    console.log("Arquivo de credenciais do Google Cloud gerado dinamicamente.");
  } catch (err) {
    console.error("Erro ao gerar arquivo de credenciais:", err);
  }
}

let ai: GoogleGenAI | null = null;
const initAI = () => {
  if (ai) return ai;
  const useVertex = process.env.VERTEX_AI_PROJECT_ID && process.env.VERTEX_AI_LOCATION;
  if (useVertex) {
    console.log("Inicializando com regras de segurança padrão-ouro: as chaves via Vertex AI estão protegidas no backend.");
    ai = new GoogleGenAI({
      vertexai: true,
      project: process.env.VERTEX_AI_PROJECT_ID,
      location: process.env.VERTEX_AI_LOCATION,
    });
  } else if (process.env.GEMINI_API_KEY) {
    console.log("Inicializando com regras de segurança padrão-ouro: a Gemini API Key está mascarada e protegida apenas no backend.");
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  } else {
    throw new Error("Credenciais de IA (Vertex ou Gemini) não configuradas. Verifique suas variáveis de ambiente.");
  }
  return ai;
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API route to fetch YouTube comments
  app.post("/api/comments", async (req, res) => {
    try {
      const { youtubeUrl } = req.body;
      if (!youtubeUrl) {
        return res.status(400).json({ error: "O link do YouTube é obrigatório" });
      }

      // Extract video ID
      const videoIdMatch = youtubeUrl.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
      const videoId = videoIdMatch ? videoIdMatch[1] : null;

      if (!videoId) {
        return res.status(400).json({ error: "Link do YouTube inválido" });
      }

      const youtubeApiKey = process.env.YOUTUBE_API_KEY;
      let comments = [];

      if (!youtubeApiKey) {
        console.log("YOUTUBE_API_KEY não encontrada. Usando comentários fictícios para a fase de testes.");
        // Mock comments in PT-BR for testing
        comments = [
          { author: "Usuario123", text: "Esse vídeo mudou minha perspectiva completamente. Explicação incrível!", likeCount: 45 },
          { author: "TechGuru", text: "A qualidade do áudio está um pouco baixa nos primeiros 5 minutos, mas o conteúdo é sólido.", likeCount: 12 },
          { author: "EspectadorAleatorio", text: "Discordo totalmente do segundo ponto. Não faz sentido no mundo real.", likeCount: 89 },
          { author: "FãDeAprendizado", text: "Obrigado por fazer isso! Estava com dificuldades nesse assunto há semanas.", likeCount: 230 },
          { author: "Critico99", text: "Muito longo e chato. Poderia ser um vídeo de 5 minutos.", likeCount: 4 },
          { author: "DesignPro", text: "Os visuais são deslumbrantes. Ótima edição!", likeCount: 56 },
          { author: "MenteCuriosa", text: "Você pode fazer uma parte 2 cobrindo as técnicas avançadas?", likeCount: 120 },
          { author: "ObservadorNeutro", text: "É um vídeo ok. Nada inovador, mas bom para iniciantes.", likeCount: 15 },
          { author: "PassarinhoBravo", text: "Título caça-clique! Você nem respondeu a pergunta principal do vídeo.", likeCount: 300 },
          { author: "AcampanteFeliz", text: "Inscrito! Melhor tutorial sobre esse assunto. Me ajudou muito no meu projeto.", likeCount: 78 }
        ];
      } else {
        // Fetch comments from YouTube API
        const youtubeResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&key=${youtubeApiKey}&maxResults=30`
        );

        if (!youtubeResponse.ok) {
          const errorData = await youtubeResponse.json();
          return res.status(500).json({ error: "Falha ao buscar comentários do YouTube", details: errorData });
        }

        const youtubeData = await youtubeResponse.json();
        
        if (!youtubeData.items || youtubeData.items.length === 0) {
          return res.status(404).json({ error: "Nenhum comentário encontrado para este vídeo." });
        }

        comments = youtubeData.items.map((item: any) => ({
          author: item.snippet.topLevelComment.snippet.authorDisplayName,
          text: item.snippet.topLevelComment.snippet.textOriginal,
          likeCount: item.snippet.topLevelComment.snippet.likeCount,
        }));
      }

      res.json({
        videoId,
        commentCount: comments.length,
        comments
      });

    } catch (error: any) {
      console.error("Erro ao buscar comentários:", error);
      res.status(500).json({ error: error.message || "Ocorreu um erro inesperado" });
    }
  });

  // API route to perform AI analysis
  app.post("/api/analyze-comments", async (req, res) => {
    try {
      const { commentsText } = req.body;
      if (!commentsText) return res.status(400).json({ error: "O texto dos comentários é obrigatório" });

      const genAI = initAI();
      const aiResponse = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Analise os seguintes comentários do YouTube. Forneça uma análise abrangente de social listening em português do Brasil.
        
IMPORTANTE:
- Certifique-se de usar a acentuação correta da língua portuguesa (UTF-8).
- Para a aderência ao conteúdo do vídeo, responda APENAS com "Sim" ou "Não".

Comentários:
${commentsText}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sentimento: {
                type: Type.OBJECT,
                description: "Porcentagem de sentimentos somando 100",
                properties: {
                  positivo: { type: Type.NUMBER },
                  neutro: { type: Type.NUMBER },
                  negativo: { type: Type.NUMBER }
                },
                required: ["positivo", "neutro", "negativo"]
              },
              resumo: {
                type: Type.STRING,
                description: "Um breve resumo do sentimento geral e dos principais pontos discutidos."
              },
              palavrasChave: {
                type: Type.ARRAY,
                description: "As 15 palavras-chave mais comuns. 'text' é a palavra, 'value' é a relevância/frequência de 10 a 100.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    value: { type: Type.NUMBER }
                  },
                  required: ["text", "value"]
                }
              },
              topicosPrincipais: {
                type: Type.ARRAY,
                description: "Os tópicos mais recorrentes discutidos nos comentários.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    topico: { type: Type.STRING },
                    descricao: { type: Type.STRING }
                  },
                  required: ["topico", "descricao"]
                }
              },
              comentariosDestaque: {
                type: Type.ARRAY,
                description: "3 a 5 comentários interessantes ou representativos.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    autor: { type: Type.STRING },
                    texto: { type: Type.STRING },
                    sentimento: { type: Type.STRING, description: "Positivo, Neutro ou Negativo" },
                    aderencia: { type: Type.STRING, description: "Sim ou Não" }
                  },
                  required: ["autor", "texto", "sentimento", "aderencia"]
                }
              },
              acoesRecomendadas: {
                type: Type.ARRAY,
                description: "Lista de 3 a 5 ações práticas sugeridas ao criador de conteúdo baseadas no feedback e oportunidades dos comentários.",
                items: {
                  type: Type.STRING
                }
              },
              todosComentarios: {
                type: Type.ARRAY,
                description: "Análise individual de TODOS os comentários fornecidos na entrada.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    autor: { type: Type.STRING },
                    texto: { type: Type.STRING },
                    sentimento: { type: Type.STRING, description: "Positivo, Neutro ou Negativo" },
                    aderencia: { type: Type.STRING, description: "Sim ou Não" },
                    analise: { type: Type.STRING, description: "Breve análise sobre o comentário" }
                  },
                  required: ["autor", "texto", "sentimento", "aderencia", "analise"]
                }
              }
            },
            required: ["sentimento", "resumo", "palavrasChave", "topicosPrincipais", "comentariosDestaque", "acoesRecomendadas", "todosComentarios"]
          }
        }
      });

      const responseText = aiResponse.text;
      if (!responseText) {
        throw new Error("IA retornou resposta vazia.");
      }

      const jsonStr = responseText.replace(/```json\n|\n```/g, "");
      const analysisJSON = JSON.parse(jsonStr);
      res.json(analysisJSON);
    } catch (error: any) {
      console.error("Erro na análise com IA:", error);
      res.status(500).json({ error: error.message || "Erro na geração de IA" });
    }
  });

  // API route to suggest a reply
  app.post("/api/suggest-reply", async (req, res) => {
    try {
      const { videoTitle, videoAuthor, commentText } = req.body;
      if (!commentText) return res.status(400).json({ error: "O texto do comentário é obrigatório" });

      const genAI = initAI();
      const aiResponse = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Você é o criador do vídeo "${videoTitle || 'deste vídeo'}" (Canal: ${videoAuthor || 'criador de conteúdo'}). Escreva uma resposta para o seguinte comentário de um inscrito: "${commentText}". \n\nINSTRUÇÕES IMPORTANTES:\n- A resposta deve ser realizada no tom de voz característico da marca ou do perfil do conteúdo deste vídeo. Busque informações sobre esse tom de voz. Em casos onde não for possível identificar, adote um tom de voz respeitoso e amigável.\n- Mantenha a resposta curta, educada e engajadora.\n- Responda APENAS com o texto da resposta, sem aspas, explicações ou introduções.`
      });

      res.json({ text: aiResponse.text || "Sem resposta." });
    } catch (error: any) {
      console.error("Erro ao gerar resposta com IA:", error);
      let errorMessage = 'Erro ao gerar resposta.';
      if (error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED")) {
        errorMessage = 'Limite de IA atingido. Tente novamente em um minuto.';
      }
      res.status(500).json({ error: errorMessage });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
