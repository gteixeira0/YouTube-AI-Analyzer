import React, { useState, useRef } from "react";
import { Search, Youtube, BarChart3, MessageSquare, AlertCircle, Loader2, Hash, Target, TrendingUp, Download, FileText, Sparkles, Terminal } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

// Cache for results to avoid re-fetching and re-analyzing
const analysisCache = new Map<string, AnalysisResult>();

interface VideoDetails {
  title: string;
  author_name: string;
  thumbnail_url: string;
}

interface AnalysisResult {
  videoId: string;
  videoDetails?: VideoDetails;
  commentCount: number;
  analysis: {
    sentimento: {
      positivo: number;
      neutro: number;
      negativo: number;
    };
    resumo: string;
    palavrasChave: { text: string; value: number }[];
    topicosPrincipais: {
      topico: string;
      descricao: string;
    }[];
    comentariosDestaque: {
      autor: string;
      texto: string;
      sentimento: string;
      aderencia: string;
    }[];
    acoesRecomendadas: string[];
    todosComentarios: {
      autor: string;
      texto: string;
      sentimento: string;
      aderencia: string;
      analise: string;
    }[];
  };
}

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [replies, setReplies] = useState<Record<number, { loading: boolean; text: string }>>({});
  const [filterKeyword, setFilterKeyword] = useState<string | null>(null);
  const [filterSentiment, setFilterSentiment] = useState<string>("Todos");
  const [filterAdherence, setFilterAdherence] = useState<string>("Todos");
  const [isExportingCSV, setIsExportingCSV] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const exportToPDF = async () => {
    if (!reportRef.current) return;
    setIsExportingPDF(true);
    
    try {
      const width = reportRef.current.offsetWidth;
      let height = reportRef.current.offsetHeight;

      // Adjust height to end 10px below the highlight section (before the hidden table)
      if (tableRef.current && tableRef.current.previousElementSibling) {
        const reportRect = reportRef.current.getBoundingClientRect();
        const highlightRect = tableRef.current.previousElementSibling.getBoundingClientRect();
        height = (highlightRect.bottom - reportRect.top) + 10;
      }

      const dataUrl = await toPng(reportRef.current, {
        backgroundColor: '#09090b', // zinc-950
        pixelRatio: 1.5,
        cacheBust: true,
        height: height,
        filter: (node) => {
          if (node.classList && typeof node.classList.contains === 'function' && node.classList.contains('print:hidden')) {
            return false;
          }
          return true;
        }
      });

      // Define o PDF para ter as exatas dimensões da tela capturada (página única contínua)
      const pdf = new jsPDF({
        orientation: width > height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [width, height]
      });

      pdf.addImage(dataUrl, 'PNG', 0, 0, width, height);
      pdf.save('relatorio-social-listening.pdf');
    } catch (err) {
      console.error("Erro ao gerar PDF:", err);
      alert("Falha ao gerar o arquivo PDF.");
    } finally {
      setIsExportingPDF(false);
    }
  };

  const handleSuggestReply = async (index: number, commentText: string) => {
    setReplies(prev => ({ ...prev, [index]: { loading: true, text: '' } }));
    try {
      const videoTitle = result?.videoDetails?.title || 'deste vídeo';
      const videoAuthor = result?.videoDetails?.author_name || 'criador de conteúdo';

      const response = await fetch("/api/suggest-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoTitle, videoAuthor, commentText })
      });
      
      const responseData = await response.json();
      if (!response.ok) {
        throw new Error(responseData.error || 'Erro ao gerar resposta.');
      }

      setReplies(prev => ({ ...prev, [index]: { loading: false, text: responseData.text || 'Sem resposta.' } }));
    } catch (err: any) {
      console.error("Erro ao gerar resposta:", err);
      let errorMessage = 'Erro ao gerar resposta.';
      if (err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED")) {
        errorMessage = 'Limite de IA atingido. Tente novamente em um minuto.';
      }
      setReplies(prev => ({ ...prev, [index]: { loading: false, text: errorMessage } }));
    }
  };

  const exportToCSV = () => {
    if (!result || !result.analysis.todosComentarios) return;

    setIsExportingCSV(true);

    try {
      const headers = ['Autor', 'Comentário', 'Sentimento', 'Aderência', 'Análise'];
      const csvContent = [
        headers.join(','),
        ...result.analysis.todosComentarios.map(c => 
          [
            `"${c.autor.replace(/"/g, '""')}"`,
            `"${c.texto.replace(/"/g, '""')}"`,
            `"${c.sentimento.replace(/"/g, '""')}"`,
            `"${c.aderencia.replace(/"/g, '""')}"`,
            `"${c.analise.replace(/"/g, '""')}"`
          ].join(',')
        )
      ].join('\n');

      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', 'analise-comentarios.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      // Keep loading spinner for at least 500ms to be visible
      setTimeout(() => {
        setIsExportingCSV(false);
      }, 500);
    }
  };

  const handleExampleClick = (exampleUrl: string) => {
    setUrl(exampleUrl);
    handleAnalyze(undefined, exampleUrl);
  };

  const handleAnalyze = async (e?: React.FormEvent, overrideUrl?: string) => {
    if (e) e.preventDefault();
    const targetUrl = overrideUrl || url;
    if (!targetUrl) return;

    // 1. Check Cache
    const videoIdMatch = targetUrl.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    const extractedVideoId = videoIdMatch ? videoIdMatch[1] : null;

    if (extractedVideoId && analysisCache.has(extractedVideoId)) {
      setResult(analysisCache.get(extractedVideoId)!);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setFilterKeyword(null);
    setFilterSentiment("Todos");
    setFilterAdherence("Todos");
    setProgress(10);
    setProgressText("Conectando ao YouTube...");

    try {
      // 2. Fetch Video Metadata (OEmbed is public and doesn't need API key)
      let videoDetails: VideoDetails | undefined;
      try {
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${targetUrl}&format=json`);
        if (oembedRes.ok) {
          videoDetails = await oembedRes.json();
        }
      } catch (e) {
        console.warn("Could not fetch video metadata", e);
      }

      // 3. Fetch comments from backend
      const commentsResponse = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: targetUrl }),
      });

      setProgress(30);
      setProgressText("Processando resposta do YouTube...");

      const commentsData = await commentsResponse.json();

      if (!commentsResponse.ok) {
        throw new Error(commentsData.error || "Falha ao buscar comentários");
      }

      const { videoId, commentCount, comments } = commentsData;

      setProgress(40);
      setProgressText(`Extraídos ${commentCount} comentários. Iniciando análise com IA...`);

      // 4. Prepare comments for Gemini
      const commentsText = comments.map((c: any) => `${c.author}: ${c.text}`).join("\n---\n");

      // Simulate progress during the long Gemini request
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 95) {
            setProgressText("Finalizando análise detalhada...");
            return 95;
          }
          if (prev === 60) setProgressText("Processando sentimentos e tópicos...");
          if (prev === 80) setProgressText("Gerando tabela de resultados...");
          return prev + 5;
        });
      }, 1500);

      // 5. Call Backend API for Gemini/Vertex Analysis
      const analysisResponse = await fetch("/api/analyze-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentsText })
      });

      if (!analysisResponse.ok) {
        const errorData = await analysisResponse.json();
        throw new Error(errorData.error || "Falha ao analisar comentários com IA");
      }

      const analysis = await analysisResponse.json();

      clearInterval(progressInterval);
      setProgress(100);
      setProgressText("Análise concluída! Renderizando resultados...");

      const newResult: AnalysisResult = {
        videoId,
        videoDetails,
        commentCount,
        analysis
      };

      setResult(newResult);
      analysisCache.set(videoId, newResult); // Save to cache

    } catch (err: any) {
      console.error("Erro na análise:", err);
      if (err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED")) {
        setError("O limite de requisições da Inteligência Artificial foi atingido. Por favor, aguarde um minuto e tente novamente.");
      } else {
        setError(err.message || "Ocorreu um erro inesperado durante a análise.");
      }
    } finally {
      setLoading(false);
    }
  };

  const sentimentData = result ? [
    { name: "Positivo", value: result.analysis.sentimento.positivo, count: Math.round((result.analysis.sentimento.positivo / 100) * result.commentCount), color: "#22c55e" },
    { name: "Neutro", value: result.analysis.sentimento.neutro, count: Math.round((result.analysis.sentimento.neutro / 100) * result.commentCount), color: "#eab308" },
    { name: "Negativo", value: result.analysis.sentimento.negativo, count: Math.round((result.analysis.sentimento.negativo / 100) * result.commentCount), color: "#ef4444" },
  ] : [];

  const filteredComments = result ? result.analysis.todosComentarios.filter(comment => {
    const matchKeyword = filterKeyword ? comment.texto.toLowerCase().includes(filterKeyword.toLowerCase()) : true;
    const matchSentiment = filterSentiment !== "Todos" ? comment.sentimento.toLowerCase() === filterSentiment.toLowerCase() : true;
    const matchAdherence = filterAdherence !== "Todos" ? comment.aderencia.toLowerCase() === filterAdherence.toLowerCase() : true;
    return matchKeyword && matchSentiment && matchAdherence;
  }) : [];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30 relative overflow-x-hidden">
      {/* Background Glows */}
      <div className="fixed top-[-20vh] left-[20vw] w-[600px] h-[600px] opacity-20 pointer-events-none z-0">
        <div className="absolute inset-0 bg-indigo-500 blur-[120px] rounded-full mix-blend-screen" />
      </div>
      <div className="fixed bottom-[-10vh] right-[-10vw] w-[500px] h-[500px] opacity-10 pointer-events-none z-0">
        <div className="absolute inset-0 bg-violet-500 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      {/* Header */}
      <header className="bg-zinc-950/80 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-500/10 p-2 rounded-lg border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.15)]">
              <Youtube className="w-5 h-5 text-indigo-400" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              YouTube AI Analyzer
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 space-y-12 print:py-4">
        {/* Input Section */}
        <section className="max-w-4xl mx-auto text-center space-y-8 print:hidden">
          <div className="flex justify-center mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/80 border border-white/10 text-sm font-medium text-zinc-300 shadow-sm backdrop-blur-md">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              Social Listening e Análise de dados
            </div>
          </div>
          
          <div className="space-y-4">
            <h2 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white leading-tight">
              Escale o seu Social Listening <br className="hidden md:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">com Inteligência Artificial</span>
            </h2>
            <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto">
              Reduza drasticamente as horas de análise manual. Descubra o sentimento real da audiência e direcione estratégias de crescimento com dados precisos.
            </p>
          </div>

          <form onSubmit={handleAnalyze} className="flex flex-col sm:flex-row gap-3 max-w-2xl mx-auto mt-10">
            <div className="relative flex-1 group">
              <Youtube className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-indigo-400 transition-colors" />
              <Input
                type="url"
                placeholder="Cole o link do vídeo aqui..."
                className="pl-12 h-14 text-base bg-zinc-900/80 border-white/10 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 text-white placeholder:text-zinc-500 rounded-full shadow-inner transition-all"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="h-14 px-8 text-base font-semibold bg-white hover:bg-zinc-200 text-zinc-950 rounded-full shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Analisando
                </>
              ) : (
                <>
                  <Search className="w-5 h-5 mr-2" />
                  Analisar
                </>
              )}
            </Button>
          </form>

          {/* Demo Warning */}
          <div className="max-w-2xl mx-auto mt-4 flex items-start sm:items-center gap-2 text-xs text-zinc-500 bg-zinc-900/40 p-3 rounded-lg border border-white/5 text-left sm:text-center justify-center">
            <p>
              <strong className="text-zinc-400">Versão de demonstração</strong>. Análise limitada aos 30 comentários mais relevantes para otimização de custos de API. A arquitetura de dados está construída e pronta para processamento em larga escala.
            </p>
          </div>

          {/* Example Links / Badges */}
          {!result && !loading && (
            <div className="flex flex-wrap justify-center gap-3 mt-12 opacity-80">
              <button type="button" onClick={() => handleExampleClick("https://www.youtube.com/watch?v=2t-AIbErqts")} className="px-4 py-2 rounded-full bg-zinc-900 border border-white/5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
                Netflix: Xuxa e Stranger Things
              </button>
              <button type="button" onClick={() => handleExampleClick("https://www.youtube.com/watch?v=n6IsWgL4ebk")} className="px-4 py-2 rounded-full bg-zinc-900 border border-white/5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
                Shopee: Terry Crews cantando em português
              </button>
              <button type="button" onClick={() => handleExampleClick("https://www.youtube.com/watch?v=Zmnj49aVnq0")} className="px-4 py-2 rounded-full bg-zinc-900 border border-white/5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
                Nubank: Fagundes & The Last of Us
              </button>
            </div>
          )}

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-lg flex items-start gap-3 text-left">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium">Falha na Análise</h4>
                <p className="text-sm opacity-90">{error}</p>
              </div>
            </div>
          )}
        </section>

          {/* Loading State */}
          {loading && (
            <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500">
              <div className="space-y-3 bg-zinc-900/50 backdrop-blur-sm p-6 rounded-xl border border-white/10 shadow-2xl">
                <div className="flex justify-between text-sm font-medium text-zinc-300">
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    {progressText}
                  </span>
                  <span className="text-indigo-400">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2 bg-zinc-800 [&>div]:bg-indigo-500" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse opacity-60">
                <Card className="md:col-span-1 bg-zinc-900/50 border-white/10">
                  <CardHeader>
                    <Skeleton className="h-6 w-32 bg-zinc-800" />
                    <Skeleton className="h-4 w-48 bg-zinc-800" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-48 w-full rounded-full bg-zinc-800" />
                  </CardContent>
                </Card>
                <Card className="md:col-span-2 bg-zinc-900/50 border-white/10">
                  <CardHeader>
                    <Skeleton className="h-6 w-40 bg-zinc-800" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Skeleton className="h-24 w-full bg-zinc-800" />
                    <div className="flex gap-2">
                      <Skeleton className="h-8 w-20 rounded-full bg-zinc-800" />
                      <Skeleton className="h-8 w-24 rounded-full bg-zinc-800" />
                      <Skeleton className="h-8 w-16 rounded-full bg-zinc-800" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Results Dashboard */}
          {result && !loading && (
            <div ref={reportRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 p-4 bg-zinc-950 rounded-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold tracking-tight">Relatório de Análise</h3>
                <div className="flex gap-2 print:hidden">
                  <Button variant="outline" size="sm" onClick={exportToCSV} disabled={isExportingCSV} className="border-white/10 hover:bg-white/5 text-zinc-300 cursor-pointer disabled:cursor-not-allowed">
                    {isExportingCSV ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                    CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportToPDF} disabled={isExportingPDF} className="border-white/10 hover:bg-white/5 text-zinc-300 cursor-pointer disabled:cursor-not-allowed">
                    {isExportingPDF ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                    PDF
                  </Button>
                </div>
              </div>

              {/* Video Metadata */}
              {result.videoDetails && (
                <Card className="bg-zinc-900/50 border-white/10 overflow-hidden">
                  <div className="flex flex-col sm:flex-row">
                    <div className="w-full sm:w-64 h-36 relative">
                      <img 
                        src={result.videoDetails.thumbnail_url} 
                        alt={result.videoDetails.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="p-6 flex flex-col justify-center">
                      <h4 className="text-xl font-bold mb-2 line-clamp-2">
                        <a href={`https://www.youtube.com/watch?v=${result.videoId}`} target="_blank" rel="noopener noreferrer" className="text-zinc-50 hover:text-indigo-400 transition-colors">
                          {result.videoDetails.title}
                        </a>
                      </h4>
                      <p className="text-zinc-400 flex items-center gap-2">
                        <Youtube className="w-4 h-4 text-rose-500" />
                        {result.videoDetails.author_name}
                      </p>
                    </div>
                  </div>
                </Card>
              )}

            {/* Big Numbers */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-zinc-900/50 border-white/10">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-400">Total de comentários analisados</p>
                    <h4 className="text-3xl font-bold text-zinc-50">{result.commentCount}</h4>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-zinc-900/50 border-white/10">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className={`p-3 rounded-lg border ${
                    (result.analysis.sentimento.positivo - result.analysis.sentimento.negativo) > 0 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                      : (result.analysis.sentimento.positivo - result.analysis.sentimento.negativo) < 0 
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' 
                        : 'bg-zinc-800/50 text-zinc-400 border-zinc-700'
                  }`}>
                    <TrendingUp className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-400">Net Sentiment Score</p>
                    <h4 className="text-3xl font-bold text-zinc-50">
                      {((result.analysis.sentimento.positivo - result.analysis.sentimento.negativo) > 0 ? '+' : '')}
                      {(result.analysis.sentimento.positivo - result.analysis.sentimento.negativo).toFixed(1)}
                    </h4>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-zinc-900/50 border-white/10">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 bg-violet-500/10 text-violet-400 rounded-lg border border-violet-500/20">
                    <Target className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-400">Aderência ao Conteúdo</p>
                    <h4 className="text-3xl font-bold text-zinc-50">
                      {Math.round((result.analysis.todosComentarios.filter(c => c.aderencia.toLowerCase() === 'sim').length / Math.max(result.analysis.todosComentarios.length, 1)) * 100)}%
                    </h4>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Sentiment Chart */}
              <Card className="md:col-span-1 bg-zinc-900/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-zinc-50">Visão Geral de Sentimento</CardTitle>
                  <CardDescription className="text-zinc-400">Distribuição das emoções do público</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={sentimentData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                          stroke="none"
                          label={({ value }) => `${Math.round(value)}%`}
                          labelLine={false}
                          onClick={(data) => {
                            const isSelected = filterSentiment === data.name;
                            if (isSelected) {
                              setFilterSentiment("Todos");
                            } else {
                              setFilterSentiment(data.name);
                              setTimeout(() => {
                                if (tableRef.current) {
                                  const y = tableRef.current.getBoundingClientRect().top + window.scrollY - 100;
                                  window.scrollTo({ top: y, behavior: 'smooth' });
                                }
                              }, 100);
                            }
                          }}
                        >
                          {sentimentData.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={entry.color} 
                              className="cursor-pointer hover:opacity-80 transition-opacity"
                            />
                          ))}
                        </Pie>
                        <RechartsTooltip 
                          formatter={(value: number, name: string, props: any) => [
                            `${props.payload.count} comentários (${value}%)`, 
                            name
                          ]}
                          contentStyle={{ backgroundColor: '#18181b', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', color: '#f4f4f5' }}
                          itemStyle={{ color: '#f4f4f5' }}
                        />
                        <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: '#a1a1aa' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Summary & Keywords */}
              <Card className="md:col-span-2 bg-zinc-900/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-zinc-50">Resumo da IA & Palavras-chave</CardTitle>
                  <CardDescription className="text-zinc-400">Principais conclusões e termos mais citados</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="prose prose-invert max-w-none">
                    <p className="text-zinc-300 leading-relaxed text-lg">
                      {result.analysis.resumo}
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-100 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Hash className="w-4 h-4 text-indigo-400" /> Nuvem de Palavras
                    </h4>
                    <div className="flex flex-wrap justify-center items-center gap-4 p-8 bg-zinc-950/50 rounded-xl border border-white/5 min-h-[200px]">
                      {result.analysis.palavrasChave.map((palavra, i) => {
                        const fontSize = 0.8 + (palavra.value / 100) * 2; // Scale font size based on value
                        const opacity = 0.4 + (palavra.value / 100) * 0.6; // Scale opacity
                        const isSelected = filterKeyword === palavra.text;
                        return (
                          <span 
                            key={i} 
                            style={{ 
                              fontSize: `${fontSize}rem`, 
                              opacity: isSelected ? 1 : opacity
                            } as React.CSSProperties} 
                            className={`font-bold transition-all duration-300 ease-out cursor-pointer hover:scale-125 hover:-translate-y-1 hover:z-10 hover:opacity-100 hover:drop-shadow-[0_0_15px_rgba(99,102,241,0.5)] relative ${isSelected ? 'text-indigo-300 scale-110 drop-shadow-[0_0_10px_rgba(99,102,241,0.8)]' : 'text-indigo-400'}`}
                            title={`Relevância: ${palavra.value} - Clique para filtrar`}
                            onClick={() => {
                              if (isSelected) {
                                setFilterKeyword(null);
                              } else {
                                setFilterKeyword(palavra.text);
                                setTimeout(() => {
                                  if (tableRef.current) {
                                    const y = tableRef.current.getBoundingClientRect().top + window.scrollY - 100;
                                    window.scrollTo({ top: y, behavior: 'smooth' });
                                  }
                                }, 100);
                              }
                            }}
                          >
                            {palavra.text}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Topics */}
              <Card className="md:col-span-3 bg-zinc-900/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-zinc-50">Tópicos Recorrentes</CardTitle>
                  <CardDescription className="text-zinc-400">Os assuntos mais discutidos nos comentários</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {result.analysis.topicosPrincipais.map((topico, i) => (
                      <div key={i} className="bg-zinc-900 rounded-xl p-4 border border-white/5 shadow-sm">
                        <h5 className="font-bold text-zinc-100 mb-2 flex items-center gap-2">
                          <Target className="w-4 h-4 text-indigo-400" />
                          {topico.topico}
                        </h5>
                        <p className="text-zinc-400 text-sm leading-relaxed">
                          {topico.descricao}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Highlighted Comments */}
              <Card className="md:col-span-3 bg-zinc-900/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-zinc-50">Comentários em Destaque</CardTitle>
                  <CardDescription className="text-zinc-400">Feedback representativo do público com análise de aderência</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {result.analysis.comentariosDestaque.map((comment, i) => (
                      <div key={i} className="bg-zinc-900 rounded-xl p-5 border border-white/5 space-y-4 flex flex-col justify-between">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-zinc-100">@{comment.autor}</span>
                            <Badge 
                              variant="secondary" 
                              className={
                                comment.sentimento.toLowerCase() === 'positivo' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                comment.sentimento.toLowerCase() === 'negativo' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                                'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                              }
                            >
                              {comment.sentimento}
                            </Badge>
                          </div>
                          <p className="text-zinc-400 text-sm leading-relaxed italic">
                            "{comment.texto}"
                          </p>
                        </div>
                        <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                          <span className="text-zinc-500 font-medium uppercase tracking-wider">Aderência ao Conteúdo:</span>
                          <span className={
                            comment.aderencia.toLowerCase() === 'sim' ? 'text-emerald-400 font-bold' :
                            'text-rose-400 font-bold'
                          }>
                            {comment.aderencia}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Ações Recomendadas */}
              <Card className="md:col-span-3 bg-zinc-900/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-zinc-50 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-400" />
                    Ações Recomendadas
                  </CardTitle>
                  <CardDescription className="text-zinc-400">Sugestões baseadas nos comentários e análise de dados gerados pela IA.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {result.analysis.acoesRecomendadas?.map((acao, index) => (
                      <li key={index} className="bg-zinc-900 border border-white/5 rounded-lg p-4 flex gap-3 text-zinc-300">
                        <span className="text-indigo-400 font-bold shrink-0">{index + 1}.</span>
                        <p>{acao}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* All Comments Table */}
              <Card className="md:col-span-3 bg-zinc-900/50 border-white/10 print:hidden" ref={tableRef}>
                <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-zinc-50">Análise Detalhada dos Comentários</CardTitle>
                    <CardDescription className="text-zinc-400">Visão geral de todos os comentários extraídos e analisados individualmente</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {filterKeyword && (
                      <Badge variant="secondary" className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-indigo-500/30 transition-colors" onClick={() => setFilterKeyword(null)}>
                        Palavra: {filterKeyword}
                        <span className="ml-1 font-bold">&times;</span>
                      </Badge>
                    )}
                    <select 
                      className="bg-zinc-950 border border-white/10 text-zinc-300 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      value={filterSentiment}
                      onChange={(e) => setFilterSentiment(e.target.value)}
                    >
                      <option value="Todos">Sentimento: Todos</option>
                      <option value="Positivo">Positivo</option>
                      <option value="Neutro">Neutro</option>
                      <option value="Negativo">Negativo</option>
                    </select>
                    <select 
                      className="bg-zinc-950 border border-white/10 text-zinc-300 text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      value={filterAdherence}
                      onChange={(e) => setFilterAdherence(e.target.value)}
                    >
                      <option value="Todos">Aderência: Todos</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border border-white/10 overflow-hidden">
                    <Table className="table-fixed w-full">
                      <TableHeader className="bg-zinc-900">
                        <TableRow className="border-white/10 hover:bg-transparent">
                          <TableHead className="w-[12%] text-zinc-400">Autor</TableHead>
                          <TableHead className="w-[30%] text-zinc-400">Comentário</TableHead>
                          <TableHead className="w-[10%] text-zinc-400">Sentimento</TableHead>
                          <TableHead className="w-[10%] text-zinc-400">Aderência</TableHead>
                          <TableHead className="w-[20%] text-zinc-400">Análise</TableHead>
                          <TableHead className="w-[18%] text-zinc-400">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredComments.length > 0 ? filteredComments.map((comment, i) => (
                          <TableRow key={i} className="border-white/10 hover:bg-white/5">
                            <TableCell className="font-medium text-zinc-100 break-words whitespace-normal">@{comment.autor}</TableCell>
                            <TableCell className="text-zinc-400 break-words whitespace-normal">{comment.texto}</TableCell>
                            <TableCell>
                              <Badge 
                                variant="secondary" 
                                className={
                                  comment.sentimento.toLowerCase() === 'positivo' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                  comment.sentimento.toLowerCase() === 'negativo' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                                  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                }
                              >
                                {comment.sentimento}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge 
                                variant="outline" 
                                className={
                                  comment.aderencia.toLowerCase() === 'sim' ? 'border-emerald-500/20 text-emerald-400 bg-emerald-500/10' :
                                  'border-rose-500/20 text-rose-400 bg-rose-500/10'
                                }
                              >
                                {comment.aderencia}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-zinc-400 leading-relaxed break-words whitespace-normal">{comment.analise}</TableCell>
                            <TableCell className="align-top">
                              <div className="space-y-2 w-full min-w-[150px]">
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="w-full bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:bg-indigo-500/20 hover:text-indigo-300"
                                  onClick={() => handleSuggestReply(i, comment.texto)}
                                  disabled={replies[i]?.loading}
                                >
                                  {replies[i]?.loading ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  ) : (
                                    <Sparkles className="w-4 h-4 mr-2" />
                                  )}
                                  Sugerir Resposta
                                </Button>
                                {replies[i]?.text && (
                                  <div className="p-3 bg-zinc-950 rounded-lg border border-white/5 text-sm text-zinc-300 italic relative break-words whitespace-normal w-full">
                                    <span className="absolute -top-2 left-3 bg-zinc-950 px-1 text-[10px] text-indigo-400 font-bold uppercase tracking-wider">IA</span>
                                    {replies[i].text}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )) : (
                          <TableRow>
                            <TableCell colSpan={6} className="h-24 text-center text-zinc-500">
                              Nenhum comentário encontrado com os filtros atuais.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
