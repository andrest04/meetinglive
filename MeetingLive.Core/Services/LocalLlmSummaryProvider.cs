using System.Runtime.CompilerServices;
using System.Text;
using LLama;
using LLama.Common;
using LLama.Sampling;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Runs meeting summarization entirely in-process with LLamaSharp against a local GGUF
/// file — no external server, no install step. The model is loaded lazily on first use
/// and kept in memory for subsequent summaries; call <see cref="Dispose"/> (or let the
/// provider go out of scope) to release it.
/// </summary>
public sealed class LocalLlmSummaryProvider(string modelPath) : ISummaryProvider, IDisposable
{
    /// <summary>Persisted as <see cref="MeetingRecord.SummaryProvider"/> when this provider ran.</summary>
    public const string ProviderId = "local";



    private readonly SemaphoreSlim _loadLock = new(1, 1);
    private LLamaWeights? _weights;
    private ModelParams? _modelParams;

    public async Task<SummaryResult> SummarizeAsync(
        string transcript,
        string title,
        DateTimeOffset recordedAt,
        CancellationToken cancellationToken = default,
        string? outputLanguage = null,
        DateTimeOffset? endedAt = null,
        SummaryEnhancementContext? enhancement = null)
    {
        var (weights, _) = await EnsureModelReadyAsync(cancellationToken);
        var raw = await LocalLlmSummaryMapReduce.SummarizeAsync(
            new LocalLlmSummaryRequest(title, recordedAt, transcript, outputLanguage, endedAt, enhancement),
            text => weights.Tokenize(text, add_bos: true, special: true, Encoding.UTF8).Length,
            (prompt, maxTokens, token) => InferAsync(prompt, maxTokens, SummaryTemperature, token),
            cancellationToken);
        var (summaryMarkdown, actionItems, suggestedTitle) = SummaryMarkdownSplitter.Split(raw);
        return new SummaryResult(summaryMarkdown, actionItems, ProviderId, suggestedTitle);
    }

    public Task<string> SuggestTitleAsync(
        string transcript,
        DateTimeOffset recordedAt,
        CancellationToken cancellationToken = default,
        string? outputLanguage = null)
    {
        var prompt = CliMeetingTitlePromptBuilder.Build(transcript, recordedAt, outputLanguage);
        return InferAsync(prompt, maxTokens: 80, SummaryTemperature, cancellationToken);
    }

    public Task<string> CompletePromptAsync(string prompt, CancellationToken cancellationToken = default) =>
        InferAsync(prompt, PromptMaxTokens, PromptTemperature, cancellationToken);

    public IAsyncEnumerable<string> StreamPromptAsync(string prompt, CancellationToken cancellationToken = default) =>
        InferTokensAsync(prompt, PromptMaxTokens, PromptTemperature, cancellationToken);

    private const int PromptMaxTokens = 512;
    private const float PromptTemperature = 0.2f;
    private const float SummaryTemperature = 0.3f;

    private async Task<string> InferAsync(
        string prompt,
        int maxTokens,
        float temperature,
        CancellationToken cancellationToken)
    {
        var result = new StringBuilder();
        await foreach (var token in InferTokensAsync(prompt, maxTokens, temperature, cancellationToken))
            result.Append(token);

        var raw = result.ToString().Trim();
        if (raw.Length == 0)
            throw new InvalidOperationException("The local model did not return any content.");

        return raw;
    }

    private async IAsyncEnumerable<string> InferTokensAsync(
        string prompt,
        int maxTokens,
        float temperature,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var (weights, modelParams) = await EnsureModelReadyAsync(cancellationToken);

        var executor = new StatelessExecutor(weights, modelParams)
        {
            ApplyTemplate = true,
        };

        var inferenceParams = new InferenceParams
        {
            MaxTokens = maxTokens,
            SamplingPipeline = new DefaultSamplingPipeline { Temperature = temperature },
        };

        await foreach (var token in executor.InferAsync(prompt, inferenceParams, cancellationToken))
            yield return token;
    }

    private Task<(LLamaWeights Weights, ModelParams Params)> EnsureModelReadyAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(modelPath))
        {
            throw new FileNotFoundException(
                "The selected local summary model has not been downloaded yet. Download it from Settings first.",
                modelPath);
        }

        return EnsureLoadedAsync(cancellationToken);
    }

    private async Task<(LLamaWeights Weights, ModelParams Params)> EnsureLoadedAsync(CancellationToken cancellationToken)
    {
        if (_weights is not null && _modelParams is not null)
            return (_weights, _modelParams);

        await _loadLock.WaitAsync(cancellationToken);
        try
        {
            if (_weights is null || _modelParams is null)
            {
                var modelParams = new ModelParams(modelPath)
                {
                    ContextSize = LocalLlmSummaryMapReduce.ContextTokens,
                };
                _weights = await LLamaWeights.LoadFromFileAsync(modelParams, cancellationToken);
                _modelParams = modelParams;
            }

            return (_weights, _modelParams);
        }
        finally
        {
            _loadLock.Release();
        }
    }

    public void Dispose()
    {
        _weights?.Dispose();
        _loadLock.Dispose();
    }
}
