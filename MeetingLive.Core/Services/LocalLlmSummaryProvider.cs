using System.Text;
using LLama;
using LLama.Common;
using LLama.Sampling;

namespace MeetingLive.Core.Services;

/// <summary>
/// Runs meeting summarization entirely in-process with LLamaSharp against a local GGUF
/// file — no external server, no install step. The model is loaded lazily on first use
/// and kept in memory for subsequent summaries; call <see cref="Dispose"/> (or let the
/// provider go out of scope) to release it.
/// </summary>
public sealed class LocalLlmSummaryProvider(string modelPath) : ISummaryProvider, IDisposable
{
    private const string SummaryPrompt = """
        You are an assistant that summarizes meetings and lectures. From the transcript below,
        generate a structured summary in English with these sections:
        - Key points
        - Decisions made
        - Tasks / action items (with owner if mentioned)

        Transcript:
        {0}
        """;

    private readonly SemaphoreSlim _loadLock = new(1, 1);
    private LLamaWeights? _weights;
    private ModelParams? _modelParams;

    public async Task<string> SummarizeAsync(string transcript, CancellationToken cancellationToken = default)
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
            MaxTokens = 1024,
            SamplingPipeline = new DefaultSamplingPipeline { Temperature = 0.3f },
        };

        var prompt = string.Format(SummaryPrompt, transcript);

        var result = new StringBuilder();
        await foreach (var token in executor.InferAsync(prompt, inferenceParams, cancellationToken))
            result.Append(token);

        var summary = result.ToString().Trim();
        if (summary.Length == 0)
            throw new InvalidOperationException("The local model did not return any content.");

        return summary;
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
