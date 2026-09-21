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
        DateTimeOffset? endedAt = null)
    {
        var prompt = CliSummaryPromptBuilder.Build(title, recordedAt, transcript, outputLanguage, endedAt);
        var raw = await InferAsync(prompt, maxTokens: 1024, temperature: 0.3f, cancellationToken);
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
        return InferAsync(prompt, maxTokens: 80, temperature: 0.3f, cancellationToken);
    }

    public Task<string> CompletePromptAsync(string prompt, CancellationToken cancellationToken = default) =>
        InferAsync(prompt, maxTokens: 512, temperature: 0.2f, cancellationToken);

    private async Task<string> InferAsync(
        string prompt,
        int maxTokens,
        float temperature,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(modelPath))
        {
            throw new FileNotFoundException(
                "The selected local summary model has not been downloaded yet. Download it from Settings first.",
                modelPath);
        }

        var (weights, modelParams) = await EnsureLoadedAsync(cancellationToken);

        var executor = new StatelessExecutor(weights, modelParams)
        {
            ApplyTemplate = true,
        };

        var inferenceParams = new InferenceParams
        {
            MaxTokens = maxTokens,
            SamplingPipeline = new DefaultSamplingPipeline { Temperature = temperature },
        };

        var result = new StringBuilder();
        await foreach (var token in executor.InferAsync(prompt, inferenceParams, cancellationToken))
            result.Append(token);

        var raw = result.ToString().Trim();
        if (raw.Length == 0)
            throw new InvalidOperationException("The local model did not return any content.");

        return raw;
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
                    ContextSize = 4096,
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
