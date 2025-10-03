import { setupAuthentication } from './auth.js';
import {
    $,
    openModal,
    closeModal,
    setupCloseButtons,
    renderMainContent,
    renderDashboard,
    renderCalendar,
    showRecipeDetails,
    showRecipeSelection,
    showEventModal,
    renderTasks,
    renderGroceries,
    renderRecipeBook,
    showEditRecipeModal
} from './ui.js';
import {
    refs,
    processAndUploadCSV,
    fetchSettings,
    fetchAllRecipes,
    getMeal,
    getTasksForDate,
    saveEvent,
    deleteEvent,
    getEvent,
    updateMeal,
    removeMeal,
    saveRecipe,
    deleteRecipe,
    addTask,
    addGroceryItem,
    generateAndSaveWeeklyGroceryList
} from './api.js';

// --- CONFIGURATION ---
const MEMBER_COLORS = { 'Papa': '#d1e7ff', 'Maman': '#f8d7da', 'Gardienne': '#d4edda', 'Enfants': '#fff3cd' };
const CATEGORY_COLORS = { 'Rendez-vous': '#f5c6cb', 'École': '#ffeeba', 'Activité': '#b8daff', 'Tâche': '#a3cfbb', 'Repas': '#e2e3e5' };
const DAY_ORDER = { 'Lundi': 1, 'Mardi': 2, 'Mercredi': 3, 'Jeudi': 4, 'Vendredi': 5, 'Samedi': 6, 'Dimanche': 7 };
const RECURRING_ITEMS = ["Lait", "Jus d'orange", "Jambon", "Pain", "Fromage en tranches", "Œufs", "Yogourt", "Fruits variés (collations)"];

let currentDate = new Date();
let allRecipes = [];
let activeView = 'dashboard';
let cycleStartDate = new Date('2024-01-01');

async function initApp() {
    setupCloseButtons();

    cycleStartDate = await fetchSettings();
    allRecipes = await fetchAllRecipes();
    allRecipes.sort((a, b) => (a.Semaine - b.Semaine) || ((DAY_ORDER[a.Jour] || 99) - (DAY_ORDER[b.Jour] || 99)) || a.Repas.localeCompare(b.Repas));

    $("#import-csv-btn").addEventListener('click', () => $("#csv-file-input").click());
    $("#csv-file-input").addEventListener('change', async (e) => {
        const reader = new FileReader();
        reader.onload = async (event) => {
            cycleStartDate = await processAndUploadCSV(event.target.result);
            allRecipes = await fetchAllRecipes();
            allRecipes.sort((a, b) => (a.Semaine - b.Semaine) || ((DAY_ORDER[a.Jour] || 99) - (DAY_ORDER[b.Jour] || 99)) || a.Repas.localeCompare(b.Repas));
            alert(`Recettes importées avec succès!`);
            renderMainContent(activeView, currentDate, allRecipes, navigate);
        };
        reader.readAsText(e.target.files[0], 'UTF-8');
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navigate(e.target.dataset.view);
        });
    });

    $('#app-container').addEventListener('click', handleAppClick);
    $('#app-container').addEventListener('submit', handleAppSubmit);

    renderMainContent(activeView, currentDate, allRecipes, navigate);
}

function navigate(view) {
    activeView = view;
    renderMainContent(activeView, currentDate, allRecipes, navigate);
}

function handleAppClick(e) {
    const target = e.target;

    if (target.id === 'delete-event-btn') {
        const eventId = $('#event-id').value;
        if (eventId && confirm("Êtes-vous sûr de vouloir supprimer cet événement ?")) {
            deleteEvent(eventId).then(() => closeModal('event-modal'));
        }
    } else if (target.id === 'generate-grocery-list-btn') {
        if (confirm("Voulez-vous remplacer la liste d'épicerie actuelle par une nouvelle liste générée pour les 7 prochains jours ?")) {
            generateAndSaveWeeklyGroceryList(allRecipes, cycleStartDate, RECURRING_ITEMS)
                .then(() => alert("Liste d'épicerie générée avec succès !"));
        }
    } else if (target.closest('.meal-slot')) {
        const mealSlot = target.closest('.meal-slot');
        const activeDate = mealSlot.id.substring(mealSlot.id.indexOf('-') + 1);
        const activeMealType = mealSlot.dataset.mealType;
        const mealData = JSON.parse(mealSlot.dataset.mealData || '{}');

        if (mealData.recipeId) {
            showRecipeDetails(mealData.recipeId, allRecipes, activeDate, activeMealType);
        } else {
            const recipeSelectModal = $('#recipe-select-modal');
            recipeSelectModal.dataset.date = activeDate;
            recipeSelectModal.dataset.mealType = activeMealType;
            showRecipeSelection(allRecipes, activeMealType);
        }
    } else if (target.closest('.event-item')) {
        showEventModal(null, target.closest('.event-item').dataset.eventId, getEvent);
    } else if (target.closest('.calendar-day[data-date]')) {
        if (!target.closest('.day-content')) {
            showEventModal(target.closest('.calendar-day').dataset.date, null, getEvent);
        }
    } else if (target.id === 'add-new-recipe-btn') {
        showEditRecipeModal(null, allRecipes);
    } else if (target.id === 'remove-meal-btn') {
        const modal = $('#recipe-select-modal');
        const { date, mealType } = modal.dataset;
        removeMeal(date, mealType).then(() => closeModal('recipe-select-modal'));
    } else if (target.closest('.recipe-select-item')) {
        const modal = $('#recipe-select-modal');
        const { date, mealType } = modal.dataset;
        const recipeItem = target.closest('.recipe-select-item');
        const { id, plat } = recipeItem.dataset;
        const mealSlot = $(`#${mealType.toLowerCase()}-${date}`);
        const existingData = mealSlot ? JSON.parse(mealSlot.dataset.mealData || '{}') : {};
        const mealData = { ...existingData, recipeId: id, plat: plat };
        updateMeal(date, mealType, mealData).then(() => closeModal('recipe-select-modal'));
    } else if (target.closest('#recipe-book-table tbody tr')) {
        const row = target.closest('tr');
        if (row && row.dataset.id) {
            showEditRecipeModal(row.dataset.id, allRecipes);
        }
    } else if (target.id === 'delete-recipe-btn') {
        const form = $('#edit-recipe-form');
        const recipeId = form.querySelector('input[name="id"]').value;
        if (recipeId && confirm("Êtes-vous sûr de vouloir supprimer cette recette ? Cette action est irréversible.")) {
            deleteRecipe(recipeId).then(() => {
                allRecipes = allRecipes.filter(r => r.id !== recipeId);
                renderMainContent(activeView, currentDate, allRecipes, navigate);
                closeModal('edit-recipe-modal');
            });
        }
    }
}

function handleAppSubmit(e) {
    e.preventDefault();
    const formId = e.target.id;

    if (formId === 'event-form') {
        const eventId = $('#event-id').value;
        const assignees = [...document.querySelectorAll('#event-assignees input:checked')].map(el => el.value);
        const eventData = {
            title: $('#event-title').value,
            date: $('#event-date').value,
            category: $('#event-category').value,
            assignees: assignees
        };
        saveEvent(eventData, eventId).then(() => closeModal('event-modal'));
    } else if (formId === 'dashboard-add-grocery-form') {
        const input = $('#dashboard-grocery-item-name');
        const itemName = input.value.trim();
        if (itemName) {
            addGroceryItem(itemName).then(() => {
                const feedback = $('#dashboard-grocery-feedback');
                feedback.textContent = `"${itemName}" a été ajouté.`;
                input.value = '';
                setTimeout(() => feedback.textContent = '', 3000);
            });
        }
    } else if (formId === 'add-task-form') {
        const taskData = {
            title: $('#task-title').value,
            description: $('#task-description').value,
            dueDate: $('#task-due-date').value,
            assignee: $('#task-assignee').value,
            completed: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        addTask(taskData).then(() => e.target.reset());
    } else if (formId === 'add-grocery-form') {
        const input = $('#grocery-item-name');
        const itemName = input.value.trim();
        if (itemName) {
            addGroceryItem(itemName).then(() => input.value = '');
        }
    } else if (formId === 'edit-recipe-form') {
        const formData = new FormData(e.target);
        const recipeData = Object.fromEntries(formData.entries());
        const recipeId = e.target.querySelector('input[name="id"]') ? e.target.querySelector('input[name="id"]').value : null;
        saveRecipe(recipeData, recipeId).then(async () => {
            allRecipes = await fetchAllRecipes();
            allRecipes.sort((a, b) => (a.Semaine - b.Semaine) || ((DAY_ORDER[a.Jour] || 99) - (DAY_ORDER[b.Jour] || 99)) || a.Repas.localeCompare(b.Repas));
            renderMainContent(activeView, currentDate, allRecipes, navigate);
            closeModal('edit-recipe-modal');
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupAuthentication();
});

export { initApp, MEMBER_COLORS, CATEGORY_COLORS, DAY_ORDER };