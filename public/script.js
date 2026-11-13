
const form = document.getElementById('lessonForm');
const button = document.getElementById('generateButton');
const statusBox = document.getElementById('status');
const resultBox = document.getElementById('result');

const copyButton = document.getElementById('copyButton');
const printButton = document.getElementById('printButton');

let generatedText = '';

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const data = {
    subject: document.getElementById('subject').value.trim(),
    grade: document.getElementById('grade').value,
    topic: document.getElementById('topic').value.trim(),
    type: document.getElementById('type').value,
    extra: document.getElementById('extra').value.trim()
  };

  if (!data.subject || !data.grade || !data.topic) {
    showError('Заповніть усі обов’язкові поля.');
    return;
  }

  button.disabled = true;
  button.textContent = '⏳ Створюємо конспект...';

  statusBox.className = 'status';
  statusBox.textContent = 'Зачекайте. Штучний інтелект готує план-конспект...';

  resultBox.textContent = '';
  generatedText = '';

  copyButton.hidden = true;
  printButton.hidden = true;

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.details || result.error || 'Помилка генерації'
      );
    }

    if (!result.response) {
      throw new Error('Сервер не повернув текст конспекту.');
    }

    generatedText = result.response;

    resultBox.textContent = generatedText;

    statusBox.className = 'status success';
    statusBox.textContent = '✅ План-конспект успішно створено!';

    copyButton.hidden = false;
    printButton.hidden = false;

  } catch (error) {
    console.error('Помилка:', error);

    showError(error.message || 'Не вдалося створити конспект.');

  } finally {
    button.disabled = false;
    button.textContent = '✨ Створити план-конспект';
  }
});

function showError(message) {
  statusBox.className = 'status error';
  statusBox.textContent = '❌ Помилка: ' + message;
}

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(generatedText);

    copyButton.textContent = '✅ Скопійовано!';

    setTimeout(() => {
      copyButton.textContent = '📋 Копіювати текст';
    }, 2000);

  } catch {
    showError('Не вдалося скопіювати текст.');
  }
});

printButton.addEventListener('click', () => {
  window.print();
});
