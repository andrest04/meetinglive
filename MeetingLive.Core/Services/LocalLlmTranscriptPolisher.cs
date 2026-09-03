using System.Text;
using LLama;
using LLama.Common;
using LLama.Sampling;

namespace MeetingLive.Core.Services;

/// <summary>
/// In-process LLamaSharp polish of a transcript. Uses a short-lived executor and
/// does not share weights with summarization. Long transcripts are polished in chunks of
/// timestamped lines so they fit ContextSize 4096, then stitched in order.
/// </summary>
public sealed class LocalLlmTranscriptPolisher : ITranscriptPolisher, IDisposable
{
    /// <summary>Character budget per chunk — leaves room for the prompt inside a 4096-token context.</summary>
    public const int ChunkMaxChars = 3500;

    private readonly string _modelPath;
    private readonly SemaphoreSlim _loadLock = new(1, 1);
    private LLamaWeights? _weights;
    private ModelParams? _modelParams;

    public LocalLlmTranscriptPolisher(string modelPath)
    {
        _modelPath = modelPath;
    }

    public async Task<string> PolishAsync(
        string transcript,
        string? meetingLanguage = null,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_modelPath))
        {
            throw new FileNotFoundException(
                "The selected local summary model has not been downloaded yet. Download it from Settings first.",
                _modelPath);
        }

        var (weights, modelParams) = await EnsureLoadedAsync(cancellationToken);
        var chunks = TranscriptPolishPromptBuilder.SplitTimestampedChunks(transcript, ChunkMaxChars);
        var polished = new List<string>(chunks.Count);

        foreach (var chunk in chunks)
        {
            cancellationToken.ThrowIfCancellationRequested();
            polished.Add(await InferChunkAsync(weights, modelParams, chunk, meetingLanguage, cancellationToken));
        }

        return string.Join(Environment.NewLine, polished);
    }

    private static async Task<string> InferChunkAsync(
        LLamaWeights weights,
        ModelParams modelParams,
        string chunk,
        string? meetingLanguage,
        CancellationToken cancellationToken)
    {
        var executor = new StatelessExecutor(weights, modelParams)
        {
            ApplyTemplate = true,
        };

        var inferenceParams = new InferenceParams
        {
            MaxTokens = 2048,
            SamplingPipeline = new DefaultSamplingPipeline { Temperature = 0.2f },
        };

        var prompt = TranscriptPolishPromptBuilder.Build(chunk, meetingLanguage);
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
                var modelParams = new ModelParams(_modelPath)
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
